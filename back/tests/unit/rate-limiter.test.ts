/**
 * Tests del limitador de peticiones.
 *
 * El objetivo es demostrar que nunca se supera ni el límite por segundo ni el
 * de por minuto, y que las llamadas simultáneas se serializan. La API de 42
 * devuelve 429 "Spam Rate Limit Exceeded" cuando se pasa, y ya nos tocó.
 */

import { describe, expect, it } from 'vitest'

import { RateLimiter, createRateLimiter } from '../../src/api/rate-limiter.js'
import { createFakeClock } from '../helpers/fake-api.js'

describe('RateLimiter', () => {
  it('deja pasar la primera petición sin esperar', async () => {
    const clock = createFakeClock()
    const waits: number[] = []
    const limiter = new RateLimiter({
      minDelayMs: 550,
      maxPerMinute: 100,
      now: clock.now,
      sleep: async (ms) => {
        waits.push(ms)
        clock.advance(ms)
      },
    })

    await limiter.run(async () => 'ok')

    expect(waits).toEqual([])
  })

  it('espera el delay mínimo entre peticiones', async () => {
    const clock = createFakeClock()
    const limiter = new RateLimiter({
      minDelayMs: 550,
      maxPerMinute: 100,
      now: clock.now,
      sleep: async (ms) => {
        clock.advance(ms)
      },
    })

    await limiter.run(async () => undefined)
    await limiter.run(async () => undefined)
    await limiter.run(async () => undefined)

    // La primera no espera; las dos siguientes, 550 ms cada una.
    expect(clock.now()).toBe(1_700_000_001_100)
  })

  it('respeta el límite por segundo: no pasa de 2 req/s con 550 ms', async () => {
    const clock = createFakeClock()
    const starts: number[] = []
    const limiter = new RateLimiter({
      minDelayMs: 550,
      maxPerMinute: 1000,
      now: clock.now,
      sleep: async (ms) => {
        clock.advance(ms)
      },
    })

    for (let i = 0; i < 6; i += 1) {
      await limiter.run(async () => {
        starts.push(clock.now())
      })
    }

    for (let i = 1; i < starts.length; i += 1) {
      const previous = starts[i - 1] ?? Number.NaN
      const current = starts[i] ?? Number.NaN
      expect(current - previous).toBeGreaterThanOrEqual(550)
    }
  })

  it('espera a que se libere la ventana cuando se llega al tope por minuto', async () => {
    const clock = createFakeClock()
    const waits: number[] = []
    const limiter = new RateLimiter({
      minDelayMs: 0,
      maxPerMinute: 3,
      windowMs: 60_000,
      now: clock.now,
      sleep: async (ms) => {
        waits.push(ms)
        clock.advance(ms)
      },
    })

    for (let i = 0; i < 4; i += 1) {
      await limiter.run(async () => undefined)
    }

    // Las tres primeras pasan seguidas. La cuarta tiene que esperar a que la
    // más antigua se salga de la ventana de un minuto.
    expect(waits.length).toBe(1)
    expect(waits[0]).toBeGreaterThan(0)
  })

  it('serializa las llamadas simultáneas, en vez de dispararlas a la vez', async () => {
    const clock = createFakeClock()
    const order: string[] = []
    let concurrent = 0
    let maxConcurrent = 0

    const limiter = new RateLimiter({
      minDelayMs: 0,
      maxPerMinute: 1000,
      now: clock.now,
      sleep: async (ms) => {
        clock.advance(ms)
      },
    })

    // Se lanzan las cinco sin esperar. Si no se serializaran, `maxConcurrent`
    // llegaría a 5 y el rate limit real no serviría de nada.
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        limiter.run(async () => {
          concurrent += 1
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          order.push(`${name}:in`)
          await new Promise((resolve) => {
            setTimeout(resolve, 1)
          })
          order.push(`${name}:out`)
          concurrent -= 1
        }),
      ),
    )

    expect(maxConcurrent).toBe(1)
    expect(order).toHaveLength(10)
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]?.endsWith(':in')).toBe(true)
      expect(order[i + 1]?.endsWith(':out')).toBe(true)
    }
  })

  it('no se rompe cuando una tarea falla', async () => {
    const clock = createFakeClock()
    const limiter = new RateLimiter({
      minDelayMs: 0,
      maxPerMinute: 1000,
      now: clock.now,
      sleep: async () => undefined,
    })

    await expect(
      limiter.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // Si el fallo dejara la cadena rota, esta llamada no llegaría a ejecutarse.
    await expect(limiter.run(async () => 'sigo viva')).resolves.toBe('sigo viva')
  })

  it('propaga el resultado de la tarea sin envolverlo', async () => {
    const limiter = new RateLimiter({
      minDelayMs: 0,
      maxPerMinute: 1000,
      sleep: async () => undefined,
    })

    await expect(limiter.run(async () => 42)).resolves.toBe(42)
  })
})

describe('createRateLimiter', () => {
  it('traduce segundos a milisegundos y aplica los valores de la configuración', () => {
    const limiter = createRateLimiter({ delaySeconds: 0.55, requestsPerMinute: 100 })

    expect(limiter.minDelayMs).toBe(550)
    expect(limiter.maxPerMinute).toBe(100)
  })
})
