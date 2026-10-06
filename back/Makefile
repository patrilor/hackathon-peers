# ─────────────────────────────────────────────────────────────────────────────
# Sanatorio 42 — backend
#
# Atajos para probar en local. Todo lo que hace esto se puede hacer a mano con
# npm; esto solo quita el tic de acordarse del orden y de los flags.
#
#   make            Lista los objetivos
#   make up         Prepara todo y arranca (lo normal)
#   make check      Typecheck + lint + tests + build
#   make cache      Qué hay en la base de datos ahora mismo
#   make purge-cache
#   make flush-cache
#   make madrid     Siembra el directorio del campus (solo-Madrid)
#
# No hay `make sync`: ya no hay réplica. La caché se llena sola, proyecto a
# proyecto, a medida que alguien lo abre.
#
# El detalle de cada paso está en LOCAL.md.
# ─────────────────────────────────────────────────────────────────────────────

.DEFAULT_GOAL := help

# ── Preparar y arrancar ───────────────────────────────────────────────────────

## up: instala, crea el .env si falta, migra y arranca el servidor
up: install env migrate
	@echo ""
	@echo "  Backend en http://localhost:3000/api   (Ctrl+C para parar)"
	@echo "  Estado de la caché:  make cache"
	@echo ""
	@npm run dev

## install: instala dependencias (usa el lockfile)
install:
	@if [ -d node_modules ] && [ node_modules -nt package-lock.json ]; then \
		echo "  Dependencias al día"; \
	else \
		echo "  Instalando dependencias..."; \
		npm ci; \
	fi

## env: crea el .env desde la plantilla si no existe
env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "  Creado .env a partir de la plantilla"; \
		echo ""; \
		echo "  Ábrelo y rellena las 5 variables obligatorias:"; \
		echo "    FORTY_TWO_UID           client ID de tu app en intra.42.fr"; \
		echo "    FORTY_TWO_SECRET        el secret de esa app"; \
		echo "    FORTY_TWO_REDIRECT_URI  http://localhost:3000/api/auth/callback"; \
		echo "    FRONTEND_URL            http://localhost:5173"; \
		echo "    SESSION_SECRET          openssl rand -base64 48"; \
		echo ""; \
	else \
		echo "  .env ya existe"; \
	fi

## migrate: aplica las migraciones pendientes
migrate:
	@npm run db:migrate

## dev: solo el servidor con recarga en caliente
dev:
	@npm run dev

## start: ejecuta lo compilado (hace falta `make build` antes)
start:
	@npm start

# ── Caché ─────────────────────────────────────────────────────────────────────

## cache: cuenta lo que hay en la base de datos ahora mismo
cache:
	@npm run db:cache

## purge-cache: borra las filas caducadas de la caché
purge-cache:
	@npm run cache:purge

## flush-cache: borra TODA la caché (para reconstruirla solo-Madrid)
flush-cache:
	@npm run cache:flush

## madrid: siembra el directorio del campus (22=Madrid) para filtrar compañeros
madrid:
	@npm run madrid:seed

## reset: borra la base de datos y la vuelve a crear vacía
reset:
	@rm -rf data/
	@$(MAKE) --no-print-directory migrate
	@echo "  Base de datos vacía. Siémbrala con \`make madrid\` (el directorio de"
	@echo "  Madrid) y se llenará sola al abrir un proyecto."

# ── Probar ────────────────────────────────────────────────────────────────────

## check: lo que tiene que pasar antes de dar algo por bueno
check: typecheck lint test build

## typecheck: comprueba los tipos
typecheck:
	@npm run typecheck

## lint: ESLint
lint:
	@npm run lint

## test: suite completa
test:
	@npm test

## build: compila a dist/
build:
	@npm run build

## ping: comprueba que el servidor de make dev responde
ping:
	@curl -s -m 5 http://localhost:3000/health && echo "" || echo "  No responde. ¿Está make dev en otra terminal?"

## clean: borra lo generado: dist/, node_modules y la base de datos
clean:
	@rm -rf dist/ data/ node_modules/
	@echo "  Limpio. make up lo deja otra vez como estaba."

# ── Ayuda ─────────────────────────────────────────────────────────────────────

## help: lista los objetivos (por defecto si no se dice otro)
help:
	@echo ""
	@echo "  Sanatorio 42 — backend"
	@echo ""
	@grep -E '^## [a-z-]+:' $(MAKEFILE_LIST) \
		| sed -E 's/^## ([a-z-]+): *(.*)/\1|\2/' \
		| sort \
		| awk -F'|' '{ printf "    %-14s %s\n", $$1, $$2 }'
	@echo ""
	@echo "  Más detalle en LOCAL.md"
	@echo ""

.PHONY: up install env migrate dev start \
        cache purge-cache flush-cache madrid reset \
        check typecheck lint test build ping \
        clean help