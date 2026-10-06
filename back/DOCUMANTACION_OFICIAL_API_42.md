Whether you're looking to build an official 42 integration for your service, or you just want to build something awesome, we can help you get started .

All the resources endpoints
Accreditations
Accreditations
 GET /v2/accreditations
 GET /v2/accreditations/:id
Achievements
Meta-goals earned by users all along their progression.
account_circle GET /v2/achievements
account_circle GET /v2/cursus/:cursus_id/achievements
account_circle GET /v2/campus/:campus_id/achievements
account_circle GET /v2/titles/:title_id/achievements
 GET /v2/achievements/:id
Achievements users
Users which earned an achievement
 GET /v2/achievements/:achievement_id/achievements_users
 GET /v2/achievements_users
 GET /v2/achievements_users/:id
Alumnized users
Alumnized users
Amendments
Modifications applied to an internship.
 GET /v2/amendments
 GET /v2/users/:user_id/amendments
 GET /v2/internships/:internship_id/amendments
 GET /v2/amendments/:id
Announcements
An announcement made to users in a cursus on their homepage.
 GET /v2/announcements/graph(/on/:field(/by/:interval))
 GET /v2/announcements/:id
Anti grav units
Anti grav units users
Apps
Applications for the API v2
 GET /v2/apps
 GET /v2/users/:user_id/apps
 GET /v2/apps/:id
Attachments
All data which can be linked, like videos, pdfs, or links.
 GET /v2/project_sessions/:project_session_id/attachments
 GET /v2/projects/:project_id/attachments
 GET /v2/attachments
 GET /v2/project_sessions/:project_session_id/attachments/:id
 GET /v2/attachments/:id
Balances
The balance of a pool
Bloc deadlines
A bloc
Blocs
A bloc is the managing container of coalitions.
 GET /v2/blocs
 GET /v2/blocs/:id
Broadcasts
Broadcasts publicated on a campus
 GET /v2/campus/:campus_id/broadcasts
Campus
Places where 42 users works
 GET /v2/campus
 GET /v2/campus/:id
 GET /v2/campus/:campus_id/stats
Campus users
The users wich are in a campus
 GET /v2/campus_users
 GET /v2/users/:user_id/campus_users
 GET /v2/campus_users/:id
Certificates
certificates
Certificates users
User belonging to a certificate.
Closes
The closing of a 42 account
Clusters
The clusters
Coalitions
A users competing inside of a bloc.
 GET /v2/coalitions
 GET /v2/users/:user_id/coalitions
 GET /v2/blocs/:bloc_id/coalitions
 GET /v2/coalitions/:id
Coalitions users
coalition.
 GET /v2/coalitions/:coalition_id/coalitions_users
 GET /v2/coalitions_users
 GET /v2/users/:user_id/coalitions_users
 GET /v2/coalitions_users/:id
Commands
Products are sold on the intranet shop, here are commands
 GET /v2/products/:product_id/commands
 GET /v2/campus/:campus_id/products/:product_id/commands
Community services
A task that an user have to do for the community. Usually linked with a close.
 GET /v2/community_services/graph(/on/:field(/by/:interval))
 GET /v2/closes/:close_id/community_services
 GET /v2/community_services
 GET /v2/community_services/:id
Companies
Companies from companies website
Correction point historics
 GET /v2/users/:user_id/correction_point_historics
Cursus
An educational cycle in 42
 GET /v2/cursus
 GET /v2/cursus/:id
Cursus users
The users wich are in a cursus
 GET /v2/cursus_users/graph(/on/:field(/by/:interval))
 GET /v2/cursus_users
 GET /v2/users/:user_id/cursus_users
 GET /v2/cursus/:cursus_id/cursus_users
 GET /v2/cursus_users/:id
Dashes
The Dash is a short-time project
 GET /v2/dashes/graph(/on/:field(/by/:interval))
Dashes users
The dash of a user
 GET /v2/dashes_users/graph(/on/:field(/by/:interval))
 GET /v2/dashes_users
 GET /v2/dashes/:dash_id/dashes_users
 GET /v2/dashes_users/:id
Endpoints
A endpoint for a campus
Evaluations
The Evaluation of a project
Events
The events in a campus or a cursus
 GET /v2/events/graph(/on/:field(/by/:interval))
 GET /v2/cursus/:cursus_id/events
 GET /v2/campus/:campus_id/events
 GET /v2/campus/:campus_id/cursus/:cursus_id/events
 GET /v2/users/:user_id/events
 GET /v2/events
 GET /v2/events/:id
Events users
Users registered to an event
 GET /v2/users/:user_id/events_users
 GET /v2/events/:event_id/events_users
 GET /v2/events_users
 GET /v2/events_users/:id
account_circle POST /v2/events_users
account_circle PATCH /v2/events_users/:id
account_circle PUT /v2/events_users/:id
account_circle DELETE /v2/events_users/:id
Exams
The exam in a campus or a cursus
 GET /v2/exams/graph(/on/:field(/by/:interval))
account_circle GET /v2/cursus/:cursus_id/exams
account_circle GET /v2/campus/:campus_id/exams
account_circle GET /v2/campus/:campus_id/cursus/:cursus_id/exams
account_circle GET /v2/users/:user_id/exams
account_circle GET /v2/projects/:project_id/exams
account_circle GET /v2/exams
 GET /v2/exams/:id
Exams users
Experiences
An experience gained by an user in a particular skill.
Expertises
Pedagogic expertises
 GET /v2/expertises
 GET /v2/expertises/:id
Expertises users
Users which have an expertise
 GET /v2/expertises/:expertise_id/expertises_users
 GET /v2/users/:user_id/expertises_users
 GET /v2/expertises_users
 GET /v2/expertises_users/:id
account_circle POST /v2/expertises/:expertise_id/expertises_users
account_circle POST /v2/users/:user_id/expertises_users
account_circle POST /v2/expertises_users
account_circle PATCH /v2/expertises_users/:id
account_circle PUT /v2/expertises_users/:id
account_circle DELETE /v2/expertises_users/:id
Feedbacks
The feedback of a ScaleTeam or an Event
 GET /v2/events/:event_id/feedbacks
 GET /v2/feedbacks
 GET /v2/scale_teams/:scale_team_id/feedbacks
 GET /v2/events/:event_id/feedbacks/:id
 GET /v2/feedbacks/:id
 GET /v2/scale_teams/:scale_team_id/feedbacks/:id
account_circle POST /v2/events/:event_id/feedbacks
account_circle POST /v2/feedbacks
account_circle POST /v2/scale_teams/:scale_team_id/feedbacks
account_circle PATCH /v2/events/:event_id/feedbacks/:id
account_circle PUT /v2/events/:event_id/feedbacks/:id
account_circle PATCH /v2/feedbacks/:id
account_circle PUT /v2/feedbacks/:id
account_circle PATCH /v2/scale_teams/:scale_team_id/feedbacks/:id
account_circle PUT /v2/scale_teams/:scale_team_id/feedbacks/:id
account_circle DELETE /v2/events/:event_id/feedbacks/:id
account_circle DELETE /v2/feedbacks/:id
account_circle DELETE /v2/scale_teams/:scale_team_id/feedbacks/:id
Flags
Flags from scales
 GET /v2/flags
Flash users
The Flash Users
Flashes
The Flash
Gitlab users
Groups
Groups in which users belong to. It will display a label on their profile and on the forum.
 GET /v2/groups
 GET /v2/users/:user_id/groups
 GET /v2/groups/:id
Groups users
Users who are in a group.
 GET /v2/groups_users
 GET /v2/groups/:group_id/groups_users
 GET /v2/users/:user_id/groups_users
 GET /v2/groups_users/:id
Internships
The internship
Journals
Languages
The language
 GET /v2/languages/graph(/on/:field(/by/:interval))
 GET /v2/languages
 GET /v2/languages/:id
Languages users
The languages of a user
 GET /v2/languages_users/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/languages_users
 GET /v2/languages_users
 GET /v2/users/:user_id/languages_users/:id
 GET /v2/languages_users/:id
Levels
A level indicator for a cursus.
Locations
The location of an user in a campus
 GET /v2/locations/graph(/on/:field(/by/:interval))
 GET /v2/locations
 GET /v2/users/:user_id/locations
 GET /v2/campus/:campus_id/locations
 GET /v2/locations/:id
Mailings
Mails from and between 42 entities
Notes
A note for an user
account_circle GET /v2/users/:user_id/notes
account_circle GET /v2/campus/:campus_id/notes
account_circle GET /v2/notes
account_circle GET /v2/notes/:id
account_circle POST /v2/notes
account_circle PATCH /v2/notes/:id
account_circle PUT /v2/notes/:id
account_circle DELETE /v2/notes/:id
Notions
The elearning notion in a cursus
 GET /v2/cursus/:cursus_id/notions
 GET /v2/tags/:tag_id/notions
 GET /v2/notions
 GET /v2/notions/:id
Offers
Offers from companies website
 GET /v2/offers
 GET /v2/offers/:id
Offers users
Users who have subscribed to an offer.
Params project sessions rules
The value of a parameter for a project sessions rule.
Partnerships
Pedagogic partnerships
 GET /v2/partnerships
 GET /v2/partnerships/:id
Partnerships users
Users doing a partnership
 GET /v2/partnerships/:partnership_id/partnerships_users
 GET /v2/partnerships_users
 GET /v2/partnerships_users/:id
Patronages
A patronage between two users
Patronages reports
A report for a patronage
 GET /v2/patronages_reports/graph(/on/:field(/by/:interval))
Pools
The pool of evaluation points.
Products
Products are sold on the intranet shop
 GET /v2/products
 GET /v2/campus/:campus_id/products
 GET /v2/products/:id
 GET /v2/campus/:campus_id/products/:id
Project data
Project data for the graph
 GET /v2/project_data
 GET /v2/project_sessions/:project_session_id/project_data
 GET /v2/project_data/:id
Project sessions
A project session defines a particular behaviour for a project, based on the cursus and / or the campus .
 GET /v2/projects/:project_id/project_sessions/graph(/on/:field(/by/:interval))
 GET /v2/project_sessions/graph(/on/:field(/by/:interval))
 GET /v2/projects/:project_id/project_sessions
 GET /v2/project_sessions
 GET /v2/project_sessions/:id
Project sessions rules
A rule linked to a project session.
Project sessions skills
A skill linked to a project session.
 GET /v2/project_sessions_skills
 GET /v2/project_sessions/:project_session_id/project_sessions_skills
 GET /v2/skills/:skill_id/project_sessions_skills
 GET /v2/project_sessions_skills/:id
 GET /v2/project_sessions/:project_session_id/project_sessions_skills/:id
Projects
Pedagogic projects of a cursus
 GET /v2/cursus/:cursus_id/projects
 GET /v2/projects/:project_id/projects
 GET /v2/projects
 GET /v2/me/projects
 GET /v2/projects/:id
account_circle PATCH /v2/projects/:id/retry
account_circle PUT /v2/projects/:id/retry
Projects users
Users which did or are doing a project
 GET /v2/projects/:project_id/projects_users/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/projects_users/graph(/on/:field(/by/:interval))
 GET /v2/projects_users/graph(/on/:field(/by/:interval))
 GET /v2/projects/:project_id/projects_users
 GET /v2/users/:user_id/projects_users
 GET /v2/projects_users
 GET /v2/projects_users/:id
account_circle POST /v2/projects/:project_id/projects_users
account_circle POST /v2/users/:user_id/projects_users
account_circle POST /v2/projects_users
account_circle POST /v2/projects/:project_id/register
account_circle DELETE /v2/projects_users/:id
account_circle PATCH /v2/projects_users/:id/compile
account_circle PUT /v2/projects_users/:id/compile
account_circle PATCH /v2/projects_users/:id/retry
account_circle PUT /v2/projects_users/:id/retry
account_circle POST /v2/projects_users/register_childs_and_scales
account_circle DELETE /v2/projects_users/reset
account_circle PATCH /v2/projects_users/scale
Quests
Quests which can or must be done by users
Quests users
Users which earned an quest
 GET /v2/quests_users/graph(/on/:field(/by/:interval))
 GET /v2/quests/:quest_id/quests_users
 GET /v2/users/:user_id/quests_users
 GET /v2/quests_users
 GET /v2/quests_users/:id
Roles
Grants particular privileges to entities like users and applications
 GET /v2/roles
 GET /v2/users/:user_id/roles
 GET /v2/roles/:id
Roles entities
The applications linked to a role
 GET /v2/roles_entities/graph(/on/:field(/by/:interval))
 GET /v2/roles/:role_id/roles_entities
 GET /v2/roles_entities
 GET /v2/roles_entities/:id
Rules
A rule for a project
Scale teams
A defence of a team (on a project), involving an evaluator
 GET /v2/scale_teams/graph(/on/:field(/by/:interval))
 GET /v2/projects/:project_id/scale_teams/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/scale_teams/graph(/on/:field(/by/:interval))
 GET /v2/project_sessions/:project_session_id/scale_teams
 GET /v2/scale_teams
 GET /v2/projects/:project_id/scale_teams
 GET /v2/users/:user_id/scale_teams/as_corrector
 GET /v2/users/:user_id/scale_teams/as_corrected
 GET /v2/users/:user_id/scale_teams
 GET /v2/me/scale_teams/as_corrector
 GET /v2/me/scale_teams/as_corrected
 GET /v2/me/scale_teams
 GET /v2/project_sessions/:project_session_id/scale_teams/:id
 GET /v2/scale_teams/:id
account_circle POST /v2/project_sessions/:project_session_id/scale_teams
account_circle POST /v2/scale_teams
account_circle PATCH /v2/project_sessions/:project_session_id/scale_teams/:id
account_circle PUT /v2/project_sessions/:project_session_id/scale_teams/:id
account_circle PATCH /v2/scale_teams/:id
account_circle PUT /v2/scale_teams/:id
account_circle DELETE /v2/project_sessions/:project_session_id/scale_teams/:id
account_circle DELETE /v2/scale_teams/:id
Scales
A scale is composed by questions which allows an users to rate the quality of a project .
Scores
Points given to a coalition.
Search
Search among the intranet resources.
Skills
A particlar skill.
 GET /v2/skills
 GET /v2/cursus/:cursus_id/skills
 GET /v2/skills
 GET /v2/skills/:id
 GET /v2/skills/:id
Slots
The slots available to users for booking a project scale team.
 GET /v2/slots/graph(/on/:field(/by/:interval))
 GET /v2/projects/:project_id/slots/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/slots/graph(/on/:field(/by/:interval))
 GET /v2/slots
 GET /v2/projects/:project_id/slots
 GET /v2/users/:user_id/slots
 GET /v2/me/slots
 GET /v2/slots/:id
account_circle POST /v2/slots
account_circle PATCH /v2/slots/:id
account_circle PUT /v2/slots/:id
account_circle DELETE /v2/slots/:id
Squads
A squads is the managing container of squads_users.
Squads users
A squads_users will group users inside a same coalition
Subnotions
The elearning subnotion in a notion
 GET /v2/notions/:notion_id/subnotions
 GET /v2/subnotions
 GET /v2/subnotions/:id
Tags
Non-hierarchical keyword, acting as a meta-data and helping to describe entities.
 GET /v2/projects/:project_id/tags
 GET /v2/issues/:issue_id/tags
 GET /v2/notions/:notion_id/tags
 GET /v2/cursus/:cursus_id/tags
 GET /v2/users/:user_id/tags
 GET /v2/tags
 GET /v2/tags/:id
Tags users
Resource associating a User and a Tag.
 GET /v2/tags_users
 GET /v2/users/:user_id/tags_users
 GET /v2/cursus/:cursus_id/tags_users
 GET /v2/campus/:campus_id/tags_users
 GET /v2/tags/:tag_id/tags_users
 GET /v2/tags_users/:id
Teams
One or many users which have to finish a project together.
 GET /v2/cursus/:cursus_id/teams/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/teams/graph(/on/:field(/by/:interval))
 GET /v2/users/:user_id/projects/:project_id/teams/graph(/on/:field(/by/:interval))
 GET /v2/teams/graph(/on/:field(/by/:interval))
 GET /v2/projects/:project_id/teams/graph(/on/:field(/by/:interval))
 GET /v2/cursus/:cursus_id/teams
 GET /v2/users/:user_id/teams
 GET /v2/users/:user_id/projects/:project_id/teams
 GET /v2/teams
 GET /v2/projects/:project_id/teams
 GET /v2/project_sessions/:project_session_id/teams
 GET /v2/me/teams
 GET /v2/teams/:id
account_circle POST /v2/teams
account_circle PATCH /v2/teams/:id
account_circle PUT /v2/teams/:id
account_circle DELETE /v2/teams/:id
account_circle POST /v2/teams/:id/reset_team_uploads
Teams uploads
An uploaded mark for a team, given by a bot (like the Moulinette), without any defence.
 GET /v2/teams/:team_id/teams_uploads
 GET /v2/teams_uploads
 GET /v2/teams_uploads/:id
Teams users
Team composed of one User
 GET /v2/teams_users
 GET /v2/users/:user_id/teams_users
 GET /v2/teams/:team_id/teams_users
 GET /v2/teams_users/:id
Titles
Titles a user can obtain, generally through achievements. It will be displayed on their profile and on the forum.
 GET /v2/titles
 GET /v2/users/:user_id/titles
 GET /v2/titles/:id
Titles users
Users who have a title.
 GET /v2/titles/:title_id/titles_users
 GET /v2/users/:user_id/titles_users
 GET /v2/titles_users
 GET /v2/titles_users/:id
Transactions
Transaction represents Altarian Dollars earned.
Translations
Translations
 GET /v2/translations
 GET /v2/translations/:id
User candidatures
The candidature of an user
Users
A 42 student, staff, or any entity with a 42 account.
 GET /v2/users/graph(/on/:field(/by/:interval))
 GET /v2/users/:id/locations_stats
 GET /v2/coalitions/:coalition_id/users
 GET /v2/dashes/:dash_id/users
 GET /v2/events/:event_id/users
 GET /v2/accreditations/:accreditation_id/users
 GET /v2/teams/:team_id/users
 GET /v2/projects/:project_id/users
 GET /v2/partnerships/:partnership_id/users
 GET /v2/expertises/:expertise_id/users
 GET /v2/users
 GET /v2/cursus/:cursus_id/users
 GET /v2/campus/:campus_id/users
 GET /v2/achievements/:achievement_id/users
 GET /v2/titles/:title_id/users
 GET /v2/quests/:quest_id/users
 GET /v2/groups/:group_id/users
 GET /v2/users/:id
 GET /v2/me
 GET /v2/users/:user_id/projects_users/registration
Waitlists
Waitlist for an event or an exam.
Webhook registeries
Webhook Registeries

The 42 API provide programmatic access to read and write 42's data. You can get and interact with the whole intranet data, and do things such creating a new message on the forum, read users profiles, get datas on a project, and more. On his second version, it identifies 42 applications and users using OAuth, and responses are available in JSON.

Whether you're looking to build an official 42 integration for your service, or you just want to build something awesome, we can help you get started.

The API works over the https protocol. and accessed from the api.intra.42.fr domain.

The current endpoint is https://api.intra.42.fr/v2.
All data is sent and received as JSON.
Blank fields are included as null instead of being omitted.
All timestamps are returned in ISO 8601 format
Current version
The current API version is 2.0.

Authentication
The authentication on the 42 API works with OAuth2.

OAuth2 is a protocol that lets external apps request authorization to private details in a user’s 42 account without getting their password. This is preferred over a basic authentication because tokens can be limited to specific types of data, and can be revoked by users at any time.

All developers need to register their application before getting started. A registered OAuth application is assigned a unique Client ID and Client Secret. The Client Secret should not be shared.

Once the access token aquired, it can be passed in the URL with the access_token parameter, or in the Authorization: Bearer YOUR_TOKEN header field.

Errors
The 42 API uses the following error codes:

Http Code	Error code	Meaning
400		The request is malformed
401		Unauthorized
403		Forbidden
404		Page or resource is not found
422		Unprocessable entity
500		We have a problem with our server. Please try again later.
Connection refused		Most likely cause is not using HTTPS.
Scopes
App can have different access scopes.

Authorization scopes are a way to determine to what extent the client can use resources located in the provider.

When the client requests the authorization it specifies in which scope they would like to be authorized. This information is then displayed to the user - resource owner - and they can decide whether or not they accept the given application to be able to act in specified scopes.

Requesting a resource with wrong or insufficient scopes will return a 403 Forbidden response, with more details in the WWW-Authenticate response header. For example, for an application without the projects scope:

HTTP
POST https://api.intra.42.fr/v2/topics/4242/messages
HTTP/1.1 403 Forbidden
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Pragma: no-cache
Transfer-Encoding: chunked
Vary: Origin
WWW-Authenticate: Bearer realm="42 API", error="insufficient scope", error_description="The action need the following scopes: [forum]"
X-Application-Id: 7
X-Application-Name: Brobot
X-Application-Roles: None
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-Meta-Request-Version: 0.4.0
X-Rack-CORS: preflight-hit; no-origin
X-Request-Id: bb64ca44-142b-46a6-b590-af95e2e05e66
X-Runtime: 0.045248
X-XSS-Protection: 1; mode=block
{
"error": "Forbidden",
"message": "Insufficient scope. The action need the following scopes: [forum] (Create, update and destroy topics and messages)"
}
Pagination
The 42 API paginates all resources on the index method.

Requests that return multiple items will be paginated to 30 items by default. You have two ways to specify further pages:

The page parameter. You can also set a custom page size (up to 100) with the per_page parameter.
The page[number] paramater with the page[size] parameter.
Note that for technical reasons not all endpoints can go up to 100 on the the per_page / page[size] parameter.
The Link HTTP response header contains pagination data with first, previous, next and last raw pages links when available, under the format

link: <http://api.intra.42.fr/v2/{Resource}?page=X+1>; rel="next", <http://api.intra.42.fr/v2/{Resource}?page=X-1>; rel="prev", <http://api.intra.42.fr/v2/{Resource}?page=1>; rel="first", <http://api.intra.42.fr/v2/{Resource}?page=X+n>; rel="last"
There is also:

A X-Page header field, which contains the current page.
A X-Per-Page header field, which contains the current pagination length.
A X-Total header field, which contains the count of pages.
Filtering
The filter query parameter can be used to filter a collection on one or several fields for one or several values. The filter parameter takes the field to filter as a key, and the values to filter as the value. Multiples values must be comma-separated (,).

For example, the following is a request for all users who have their piscine in 2013, but only in September or July:

HTTP
GET /users?filter[pool_year]=2013&filter[pool_month]=september,july HTTP/1.1
Sorting
All index endpoints support multiple sort fields by allowing comma-separated (,) sort fields, they are applied in the order specified.

The sort order for each sort field is ascending unless it is prefixed with a minus (U+002D HYPHEN-MINUS, “-“), in which case it is descending.

For example, GET /users?sort=kind,-login will return the users sorted by kind. Any users with the same kind will then be sorted by their login in descending alphabetical order.

Rate limiting
By default, your applications has limited to 2 requests/second and 1200 requests / hour

JSON-API format (Decommissioned)

Getting informations about your token
If you want to know more about your token, you can fetch https://api.intra.42.fr/oauth/token/info.

Bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" https://api.intra.42.fr/oauth/token/info
# {"resource_owner_id":74,"scopes":["public"],"expires_in_seconds":7174,"application":{"uid":"3089cd94d72cc9109800a5eea5218ed4c3e891ec1784874944225878b95867f9"},"created_at":1439460680}%


Create an application
In order to use the 42 API, you first need to create a v2 application here.

You will need to configure a few things in order to make your application:

The name of your application, wich needs to be explicit (please avoid names like test or app).
The redirect URI(s). Theses URI(s) are needed if you app acts as a third tier between the 42 data and an user (this flow is called Web Application Flow), and specify where the user need to be redirected after his authentication. If you plan to use your app just as a server-side app, without user interaction, you can set any valid adress, you'll not need theses URI.
The scopes you'll need. A scope is an aera of access. By default, your application only have access to public data, it's your call to add more scopes. Try to only add the scopes you'll really need, you can change your application scopes later if you need more permissions.
Public set if your application is visible by other users or not.
All the other fields are facultative, and can be set later.
Note: The complete description of the authentication process through the OAuth2 Web Application Flow is described in the next section of this guide.

Get your credentials
Awesome ! You just created your first application ! Now, take a look on your application page, we got a lot of informations there, but the most important are:

The client uid, an unique identifier for your application.
The client secret, an secret passphrase for your application, which must be kept secret, and only used on server side, where users can't see it.
Make basic requests
Now, you have all you need to setup a little basic script using the API trough your application. In this example, we will use the Client Credentials Flow, in ruby, with the OAuth2 ruby wrapper, but OAuth2 wrappers exists in most languages. The Client Credentials flow is probably the most simple flow of OAuth 2 flows. The main difference from the others is that this flow is not associated with a user. You can read more about this OAuth flow directly from the reference documentation of OAuth2.

First of all, we'll request an access token with our application credentials.

Ruby
require "oauth2"
UID = "Your application uid"
SECRET = "Your secret token"
# Create the client with your credentials
client = OAuth2::Client.new(UID, SECRET, site: "https://api.intra.42.fr")
# Get an access token
token = client.client_credentials.get_token
Requesting an access token with the client credentials flow is, in fact, just a POST request on the /oauth/token endpoint with a grant_type parameter set to client_credentials. If you wanted to do this with the command line, the equivalent Curl line will be:

curl -X POST --data "grant_type=client_credentials&client_id=MY_AWESOME_UID&client_secret=MY_AWESOME_SECRET" https://api.intra.42.fr/oauth/token
JSON
{
"access_token":"42804d1f2480c240f94d8f24b45b318e4bf42e742f0c06a42c6f4242787af42d",
"token_type":"bearer",
"expires_in":7200,
"scope":"public",
"created_at":1443451918
}
Now, we can fetch all the public data which don't need user authentication, like the list of the cursus in 42. The reference documentation gave us (by the Cursus resource page) the endpoint /v2/cursus.

Ruby
token.get("/v2/cursus").parsed
# => [{"id"=>1, "created_at"=>"2014-11-02T17:43:38.480+01:00", "name"=>"42", "slug"=>"42", "users_count"=>1918, "users_url"=>"https://api.intra.42.fr/v2/cursus/42/users", "projects_url"=>"https://api.intra.42.fr/v2/cursus/42/projects", "topics_url"=>"https://api.intra.42.fr/v2/cursus/42/topics"}, ...]
Hooray ! We got our data ! And what about the users in the cursus 42 ?

Ruby
users_in_cursus = token.get("/v2/cursus/42/users").parsed
# => {"id"=>2, "login"=>"avisenti", "url"=>"https://api.intra.42.fr/v2/users/avisenti", "end_at"=>nil}, {"id"=>3, "login"=>"spariaud", "url"=>"https://api.intra.42.fr/v2/users/spariaud", "end_at"=>nil}, ...
users_in_cursus.count
# => 30
What the hell ? Only 30 users ? And what says the documentation about that ?

Pagination
The documentation says that the resource is paginated by 30 items by defaut, and that we can specify a page[number] parameter (or, more simpler, the page parameter), in order to navigate trough it. Let's try to fetch the second page:

Ruby
second_page = token.get("/v2/cursus/42/users", params: {page: {number: 2}})
# => #<OAuth2::Response:0x007f9ba3b7eb98 @response=#<Faraday::Response:0x007f9ba3b949c0 @on_complete_callbacks=[], @env=#<Faraday::Env @method=:get @body="[{\"id\":35,\"login\":\"droger\",\"url\":\"https://api.intra.42.fr/v2/users/droger\",\"end_at\":null},{\"id\":36,\"login\":\"edelbe\",\"url\":\"https://api.intra.42.fr/v2/users/edelbe\"...
second_page.parsed
# => {"id"=>35, "login"=>"droger", "url"=>"https://api.intra.42.fr/v2/users/droger", "end_at"=>nil}, {"id"=>36, "login"=>"edelbe", "url"=>"https://api.intra.42.fr/v2/users/edelbe", "end_at"=>nil}, ...
Well, it seems to work ! But how can we know if there is a next page ? One simple solution is to go forward until the call returns an empty array, but if we need more informations, we can take a look on the Link HTTP response header.

Ruby
second_page.headers["Link"]
# => "<https://api.intra.42.fr/v2/cursus/42/users?page=3>; rel=\"next\", <https://api.intra.42.fr/v2/cursus/42/users?page=1>; rel=\"prev\", <https://api.intra.42.fr/v2/cursus/42/users?page=1>; rel=\"first\", <https://api.intra.42.fr/v2/cursus/42/users?page=64>; rel=\"last\""
We now have the links for the first, the next, the previous and the last pages. The response headers contains a lot of more or less useful informations, like the name of your application, the id and the roles.

HTTP
GET https://api.intra.42.fr/v2/messages?page[number]=1
HTTP/1.1 200 OK
Cache-Control: max-age=0, private, must-revalidate
Content-Type: application/json; charset=utf-8
ETag: W/"b326132feb08f61b7de85a13ca83f264"
Link: <https://api.intra.42.fr/v2/messages?page=1>; rel="first", <https://api.intra.42.fr/v2/messages?page=1>; rel="prev", <https://api.intra.42.fr/v2/messages?page=586>; rel="last", <https://api.intra.42.fr/v2/messages?page=3>; rel="next"
Transfer-Encoding: chunked
Vary: Origin
X-Application-Id: 318
X-Application-Name: test-app
X-Application-Roles: None
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-Meta-Request-Version: 0.4.0
X-Page: 2
X-Per-Page: 30
X-Rack-CORS: preflight-hit; no-origin
X-Request-Id: c763e95e-95a6-4307-88da-f441038be349
X-Runtime: 0.278242
X-Total: 17570
X-XSS-Protection: 1; mode=block
{...}
You can also increase the number of results returned by the request with the page[size] parameter (or the per_page parameter). Almost all the endpoints can return up to 100 results per page.

Limits
By default, your applications has limited to 2 requests/second and 1200 requests / hour

Roles
Applications can have roles, which grants particular privileges.

There is a short list of the most common roles:

Alpha: Unstable features
Beta: Intranet beta-testers
Official App: Approved application to up rate limit
Certified App: Certified application manually by a staff member to up rate limit and access to more features
Moderator: Moderate topics, messages and versions on the forum
Basic Tutor: Manage projects, scales and all cursus related data
Basic Staff: Member of the staff, can manage community services, closes, exams and access advanced student data
The roles of your application are present in the x-application-roles field of the response header.

If your application is production ready, public and useful, you can send us a mail to request the Official App role.

That's it for now. If your want to go deeper, and allow users to use their 42 account from a third-party website, you can continue with the web application flow tutorial.

Getting informations about your token
If you want to know more about your token, you can fetch https://api.intra.42.fr/oauth/token/info.

Bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" https://api.intra.42.fr/oauth/token/info
# {"resource_owner_id":74,"scopes":["public"],"expires_in_seconds":7174,"application":{"uid":"3089cd94d72cc9109800a5eea5218ed4c3e891ec1784874944225878b95867f9"},"created_at":1439460680}%