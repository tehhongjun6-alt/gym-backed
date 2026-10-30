# WESET Backend

WESET is a full-stack fitness and social platform for tracking workouts, sharing fitness posts, connecting with friends, discovering exercises, and exploring food and meal information.

This repository contains the Express API. The React frontend is maintained in a separate repository.

## Live Application

- Frontend: [https://gym-tracker-frontend-vert.vercel.app](https://gym-tracker-frontend-vert.vercel.app)
- Backend API: [https://gym-backed-production.up.railway.app](https://gym-backed-production.up.railway.app)
- Frontend repository: [https://github.com/tehhongjun6-alt/gym-tracker-frontend](https://github.com/tehhongjun6-alt/gym-tracker-frontend)

## Technology Stack

- Node.js
- Express 5
- PostgreSQL on Supabase
- Supabase Authentication
- Supabase Storage
- `pg` for database queries
- Railway for backend deployment

## Core Backend Features

- Email/password signup and login through Supabase Auth
- Google profile synchronization
- Bearer-token verification for protected routes
- Workout create, read, update, and delete operations
- Server-side validation and workout ownership checks
- Text and image posts with public or friends-only visibility
- Signed URLs for private images in Supabase Storage
- User search and mutual friend requests
- Exercise data from API Ninjas and free-exercise-db
- Food nutrition data from USDA FoodData Central
- Meal ideas, images, ingredients, instructions, and video links from TheMealDB

## Project Files

```text
gym-tracker-backend/
|-- index.js             Express routes, validation, and external API logic
|-- db.js                PostgreSQL connection pool
|-- supabaseClient.js    Supabase public and admin clients
|-- schema.sql           Complete database schema, indexes, and Storage setup
|-- add-body-part.sql    Legacy migration for databases created before body_part
|-- package.json         Dependencies and npm scripts
`-- README.md            Backend setup and architecture guide
```

For a new database, run `schema.sql`. The separate `add-body-part.sql` file is only an upgrade script for an older database that already has the `workouts` table.

## Database Schema

The application uses four public tables:

| Table | Purpose |
| --- | --- |
| `users` | Public profile linked to a Supabase Auth user |
| `workouts` | User-owned workout records |
| `posts` | Social posts with optional image references |
| `friendships` | Pending and accepted mutual friend relationships |

Main relationships:

```text
auth.users 1 ---- 1 public.users
public.users 1 ---- many workouts
public.users 1 ---- many posts
public.users many ---- many public.users through friendships
```

The schema also creates indexes for workout history, feed ordering, post ownership, and friendship queries. A unique unordered friendship index prevents duplicate relationships in either direction.

## Supabase Setup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Copy and run the complete contents of `schema.sql` once.
4. Confirm that `users`, `workouts`, `posts`, and `friendships` appear under the `public` schema.
5. Confirm that the private `post-images` bucket appears in Storage.

The browser uploads images into a folder named with the authenticated user's UUID. The Storage policy in `schema.sql` permits authenticated users to upload only into their own folder. The backend uses the Supabase secret key to remove unused images and create signed image URLs.

The public tables have Row Level Security enabled without browser policies because the browser does not query these tables directly. Application data is accessed through the Express API, which verifies the Supabase token and uses the server-side PostgreSQL connection.

## Environment Variables

Create a `.env` file in the backend root:

```env
PORT=3000
DATABASE_URL=your_supabase_postgres_connection_string
SUPABASE_URL=your_supabase_project_url
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_secret_key
API_NINJAS_KEY=your_api_ninjas_key
USDA_API_KEY=your_usda_fooddata_central_key
```

Never commit `.env`. `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `API_NINJAS_KEY`, and `USDA_API_KEY` are server secrets and must never be placed in the frontend.

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/tehhongjun6-alt/gym-backed.git
cd gym-backed
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Supabase and environment variables

Run `schema.sql` in the Supabase SQL Editor, then create the backend `.env` file shown above.

### 4. Start the API

```bash
npm run dev
```

For a production-style local start:

```bash
npm start
```

The API uses `http://localhost:3000` by default. A successful health check returns:

```json
{
  "message": "Gym Tracker API is running"
}
```

## API Routes

Except for signup, login, and the health check, routes require this header:

```http
Authorization: Bearer <supabase_access_token>
```

### Authentication and profile

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/` | API health check |
| `POST` | `/auth/signup` | Create an email/password account and profile |
| `POST` | `/auth/login` | Sign in with email/password |
| `POST` | `/auth/google-profile` | Create or synchronize a Google user's profile |
| `GET` | `/whoami` | Return the authenticated user's profile |

### Workouts

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/workouts` | Create a workout |
| `GET` | `/workouts` | List the authenticated user's workouts |
| `PATCH` | `/workouts/:id` | Update a workout owned by the authenticated user |
| `DELETE` | `/workouts/:id` | Delete a workout owned by the authenticated user |

Workout fields are `workout_date`, `body_part`, `exercise_name`, `sets`, `reps`, and `weight`. Valid body parts are `chest`, `shoulder`, `arm`, `leg`, `core`, and `back`.

### Posts and images

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/posts` | Create a public or friends-only post |
| `GET` | `/posts` | Return posts visible to the authenticated user |
| `DELETE` | `/post-images/cleanup` | Remove an unused image owned by the user |

### Users and friends

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/users` | Search or list users and friendship state |
| `POST` | `/friend-requests` | Send a friend request |
| `GET` | `/friend-requests` | List pending incoming requests |
| `PATCH` | `/friend-requests/:id/accept` | Accept an incoming request |
| `GET` | `/friends` | List accepted friends |

### Exercise and food integrations

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/exercise-suggestions` | Search API Ninjas exercise data |
| `GET` | `/exercise-images` | Search free-exercise-db movement images |
| `GET` | `/food-calories` | Search USDA nutrition data |
| `GET` | `/meal-ideas` | Search TheMealDB meals |

## Authentication and Authorization

1. Supabase creates the user's session and access token.
2. The frontend sends the token in the `Authorization` header.
3. Express verifies the token before running protected route logic.
4. The verified Supabase user ID is used in database queries.
5. Workout update and delete queries match both the workout ID and user ID.
6. Friends-only posts are returned only to the author or an accepted friend.

This prevents a browser from claiming another user's ID to access or change their data.

## Deployment on Railway

1. Connect Railway to this GitHub repository.
2. Set the start command to `npm start` if Railway does not detect it automatically.
3. Add every backend environment variable listed above.
4. Deploy and open the Railway domain.
5. Confirm that `GET /` returns the health-check JSON.
6. Set the frontend `VITE_API_URL` to the Railway domain and redeploy the frontend.

## Error Handling

The API returns JSON errors with appropriate HTTP status codes:

- `400` for invalid input;
- `401` for missing or invalid authentication;
- `403` for forbidden image ownership operations;
- `404` for missing or non-owned records;
- `409` for duplicate or conflicting data;
- `500` for unexpected server or configuration failures;
- `502` when an external API or Storage operation is unavailable.

## Testing Status

Run the automated backend API tests with:

```bash
npm test
```

The Jest and Supertest suite mocks PostgreSQL, Supabase authentication, and third-party HTTP responses. It covers authentication rejection, workout create/update/delete and ownership, posts, friend requests and friend lists, API Ninjas exercise search, free-exercise-db image search, USDA food search, and TheMealDB meal search without changing live data or consuming external API quota.

## Product Identity

**WESET**  
**Train. Share. Together.**
