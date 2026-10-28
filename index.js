require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { pool } = require("./db");
const {
    supabase,
    supabaseAdmin,
} = require("./supabaseClient");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "Gym Tracker API is running",
    });
});

app.post("/auth/signup", async (req, res) => {
    const { username, email, password } = req.body || {};

    if (typeof username !== "string" || !username.trim()) {
        return res.status(400).json({
            error: "Username is required",
        });
    }

    if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
            error: "Email is required",
        });
    }

    if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({
            error: "Password must contain at least 6 characters",
        });
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: {
                    username: username.trim(),
                },
            },
        });

        if (error) {
            return res.status(400).json({
                error: error.message,
            });
        }

        if (!data.user) {
            return res.status(400).json({
                error: "Unable to create account",
            });
        }

        const result = await pool.query(
            `INSERT INTO users (id, username)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
            [data.user.id, username.trim()]
        );

        res.status(201).json({
            message: data.session
                ? "Account created successfully"
                : "Account created. Check your email to confirm.",
            user: result.rows[0],
            session: data.session,
        });
    } catch (error) {
        console.error("POST /auth/signup failed:", error.message);

        res.status(500).json({
            error:
                "Unable to complete registration. An Auth account may already have been created.",
        });
    }
});
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
            error: "Email is required",
        });
    }

    if (typeof password !== "string" || !password) {
        return res.status(400).json({
            error: "Password is required",
        });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });

        if (error) {
            return res.status(401).json({
                error: error.message,
            });
        }

        if (!data.session) {
            return res.status(401).json({
                error: "Unable to create a login session",
            });
        }

        res.json({
            session: data.session,
        });
    } catch (error) {
        console.error("POST /auth/login failed:", error.message);

        res.status(500).json({
            error: "Unable to log in",
        });
    }
});
async function verifySupabaseSession(req, res, next) {
    const auth = req.headers.authorization;

    if (!auth) {
        return res.status(401).json({
            error: "Access token is required",
        });
    }

    const parts = auth.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
        return res.status(401).json({
            error: "Valid Bearer token is required",
        });
    }

    try {
        const token = parts[1];

        const { data, error } = await supabase.auth.getUser(token);

        if (error || !data.user) {
            return res.status(401).json({
                error: "Invalid or expired access token",
            });
        }

        req.user = {
            userId: data.user.id,
            email: data.user.email,
        };

        next();
    } catch (error) {
        console.error("Session verification failed:", error.message);

        res.status(500).json({
            error: "Unable to verify your session",
        });
    }
}
app.post(
    "/auth/google-profile",
    verifySupabaseSession,
    async (req, res) => {
        try {
            const emailName =
                req.user.email?.split("@")[0] || "user";

            const cleanName = emailName
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "")
                .slice(0, 20);

            const username =
                `${cleanName || "user"}_${req.user.userId.slice(0, 6)}`;

            const result = await pool.query(
                `INSERT INTO users (id, username)
                 VALUES ($1, $2)
                 ON CONFLICT (id)
                 DO UPDATE SET username = users.username
                 RETURNING id, username, created_at`,
                [req.user.userId, username]
            );

            res.json(result.rows[0]);
        } catch (error) {
            console.error(
                "POST /auth/google-profile failed:",
                error.message
            );

            res.status(500).json({
                error: "Unable to create Google user profile",
            });
        }
    }
);
app.get("/whoami", verifySupabaseSession, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, username, created_at FROM users WHERE id = $1",
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "User profile not found",
            });
        }

        res.json({
            id: result.rows[0].id,
            username: result.rows[0].username,
            email: req.user.email,
            created_at: result.rows[0].created_at,
        });
    } catch (error) {
        console.error("GET /whoami failed:", error.message);

        res.status(500).json({
            error: "Unable to load your profile",
        });
    }
});

const workoutBodyParts = [
    "chest",
    "shoulder",
    "arm",
    "leg",
    "core",
    "back",
];

app.post("/workouts", verifySupabaseSession, async (req, res) => {
    const {
        workout_date,
        body_part,
        exercise_name,
        sets,
        reps,
        weight,
    } = req.body || {};

    if (typeof workout_date !== "string" || !workout_date.trim()) {
        return res.status(400).json({
            error: "Workout date is required",
        });
    }

    if (!workoutBodyParts.includes(body_part)) {
        return res.status(400).json({
            error: "Choose a valid body part",
        });
    }

    if (typeof exercise_name !== "string" || !exercise_name.trim()) {
        return res.status(400).json({
            error: "Exercise name is required",
        });
    }

    if (!Number.isInteger(sets) || sets <= 0) {
        return res.status(400).json({
            error: "Sets must be a positive integer",
        });
    }

    if (!Number.isInteger(reps) || reps <= 0) {
        return res.status(400).json({
            error: "Reps must be a positive integer",
        });
    }

    if (
        typeof weight !== "number" ||
        weight < 0 ||
        weight > 99999.99
    ) {
        return res.status(400).json({
            error: "Weight must be a number between 0 and 99999.99",
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO workouts
         (user_id, workout_date, body_part, exercise_name, sets, reps, weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [
                req.user.userId,
                workout_date.trim(),
                body_part,
                exercise_name.trim(),
                sets,
                reps,
                weight,
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (
            error.code === "22007" ||
            error.code === "22008" ||
            error.code === "22003"
        ) {
            return res.status(400).json({
                error: "Check the workout date and numeric values",
            });
        }

        if (error.code === "23503") {
            return res.status(409).json({
                error: "User profile is missing",
            });
        }

        console.error("POST /workouts failed:", error.message);

        res.status(500).json({
            error: "Unable to create workout",
        });
    }
});

app.get("/workouts", verifySupabaseSession, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
       FROM workouts
       WHERE user_id = $1
       ORDER BY workout_date DESC, id DESC`,
            [req.user.userId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("GET /workouts failed:", error.message);

        res.status(500).json({
            error: "Unable to load workouts",
        });
    }
});
app.patch("/workouts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid workout ID",
        });
    }

    const {
        workout_date,
        body_part,
        exercise_name,
        sets,
        reps,
        weight,
    } = req.body || {};

    if (
        workout_date === undefined &&
        body_part === undefined &&
        exercise_name === undefined &&
        sets === undefined &&
        reps === undefined &&
        weight === undefined
    ) {
        return res.status(400).json({
            error: "Provide at least one field to update",
        });
    }

    if (
        workout_date !== undefined &&
        (typeof workout_date !== "string" || !workout_date.trim())
    ) {
        return res.status(400).json({
            error: "Workout date cannot be empty",
        });
    }

    if (
        body_part !== undefined &&
        !workoutBodyParts.includes(body_part)
    ) {
        return res.status(400).json({
            error: "Choose a valid body part",
        });
    }

    if (
        exercise_name !== undefined &&
        (typeof exercise_name !== "string" || !exercise_name.trim())
    ) {
        return res.status(400).json({
            error: "Exercise name cannot be empty",
        });
    }

    if (
        sets !== undefined &&
        (!Number.isInteger(sets) || sets <= 0)
    ) {
        return res.status(400).json({
            error: "Sets must be a positive integer",
        });
    }

    if (
        reps !== undefined &&
        (!Number.isInteger(reps) || reps <= 0)
    ) {
        return res.status(400).json({
            error: "Reps must be a positive integer",
        });
    }

    if (
        weight !== undefined &&
        (typeof weight !== "number" || weight < 0 || weight > 99999.99)
    ) {
        return res.status(400).json({
            error: "Weight must be a number between 0 and 99999.99",
        });
    }

    try {
        const result = await pool.query(
            `UPDATE workouts
       SET workout_date = COALESCE($1, workout_date),
           body_part = COALESCE($2, body_part),
           exercise_name = COALESCE($3, exercise_name),
           sets = COALESCE($4, sets),
           reps = COALESCE($5, reps),
           weight = COALESCE($6, weight)
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
            [
                workout_date === undefined ? null : workout_date.trim(),
                body_part === undefined ? null : body_part,
                exercise_name === undefined ? null : exercise_name.trim(),
                sets,
                reps,
                weight,
                id,
                req.user.userId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Workout not found",
            });
        }

        res.json(result.rows[0]);
    } catch (error) {
        if (
            error.code === "22007" ||
            error.code === "22008" ||
            error.code === "22003"
        ) {
            return res.status(400).json({
                error: "Check the workout date and numeric values",
            });
        }

        console.error("PATCH /workouts failed:", error.message);

        res.status(500).json({
            error: "Unable to update workout",
        });
    }
});

app.delete("/workouts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid workout ID",
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM workouts
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
            [id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Workout not found",
            });
        }

        res.json({
            message: "Workout deleted successfully",
            id: result.rows[0].id,
        });
    } catch (error) {
        console.error("DELETE /workouts failed:", error.message);

        res.status(500).json({
            error: "Unable to delete workout",
        });
    }
});
async function addSignedImageUrls(posts) {
    const postsWithImageUrls = [];

    for (const post of posts) {
        let imageUrl = post.image_url;

        if (post.image_path) {
            const {
                data,
                error,
            } = await supabaseAdmin.storage
                .from("post-images")
                .createSignedUrl(
                    post.image_path,
                    60 * 60
                );

            if (error) {
                console.error(
                    "Unable to create signed image URL:",
                    error.message
                );

                imageUrl = null;
            } else {
                imageUrl = data.signedUrl;
            }
        }

        postsWithImageUrls.push({
            ...post,
            image_url: imageUrl,
        });
    }

    return postsWithImageUrls;
}
app.delete(
    "/post-images/cleanup",
    verifySupabaseSession,
    async (req, res) => {
        const { image_path } = req.body || {};

        if (typeof image_path !== "string" || !image_path.trim()) {
            return res.status(400).json({
                error: "Image path is required",
            });
        }

        const cleanImagePath = image_path.trim();
        const userFolder = `${req.user.userId}/`;

        if (!cleanImagePath.startsWith(userFolder)) {
            return res.status(403).json({
                error: "You cannot delete this image",
            });
        }

        try {
            const linkedPost = await pool.query(
                `SELECT id
         FROM posts
         WHERE author_id = $1
           AND image_path = $2
         LIMIT 1`,
                [req.user.userId, cleanImagePath]
            );

            if (linkedPost.rows.length > 0) {
                return res.status(409).json({
                    error: "This image belongs to a post",
                });
            }

            const { error: storageError } = await supabaseAdmin.storage
                .from("post-images")
                .remove([cleanImagePath]);

            if (storageError) {
                console.error("Image cleanup failed:", storageError.message);

                return res.status(502).json({
                    error: "Unable to clean up image",
                });
            }

            res.json({
                message: "Unused image deleted successfully",
            });
        } catch (error) {
            console.error(
                "DELETE /post-images/cleanup failed:",
                error.message
            );

            res.status(500).json({
                error: "Unable to clean up image",
            });
        }
    }
);

app.post("/posts", verifySupabaseSession, async (req, res) => {
    const {
        content,
        visibility = "public",
        image_url,
        image_path,
    } = req.body || {};

    if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({
            error: "Post content is required",
        });
    }

    if (visibility !== "public" && visibility !== "friends-only") {
        return res.status(400).json({
            error: "Visibility must be public or friends-only",
        });
    }

    if (
        image_url !== undefined &&
        image_url !== null &&
        typeof image_url !== "string"
    ) {
        return res.status(400).json({
            error: "Image URL must be a string",
        });
    }

    if (
        image_path !== undefined &&
        image_path !== null &&
        typeof image_path !== "string"
    ) {
        return res.status(400).json({
            error: "Image path must be a string",
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO posts
         (author_id, content, visibility, image_url, image_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
            [
                req.user.userId,
                content.trim(),
                visibility,
                image_url ? image_url.trim() : null,
                image_path ? image_path.trim() : null,
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === "23503") {
            return res.status(409).json({
                error: "User profile is missing",
            });
        }

        console.error("POST /posts failed:", error.message);

        res.status(500).json({
            error: "Unable to create post",
        });
    }
});


app.get("/posts", verifySupabaseSession, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT posts.*, users.username AS author
       FROM posts

       JOIN users ON users.id = posts.author_id

       LEFT JOIN friendships AS f
         ON f.status = 'accepted'
         AND (
           (f.requester_id = $1 AND f.receiver_id = posts.author_id)
           OR
           (f.receiver_id = $1 AND f.requester_id = posts.author_id)
         )

       WHERE posts.visibility = 'public'
          OR posts.author_id = $1
          OR (
            posts.visibility = 'friends-only'
            AND f.id IS NOT NULL
          )

       GROUP BY posts.id, users.username
       ORDER BY posts.created_at DESC, posts.id DESC`,
            [req.user.userId]
        );

        const posts = await addSignedImageUrls(
            result.rows
        );

        res.json(posts);
    } catch (error) {
        console.error("GET /posts failed:", error.message);

        res.status(500).json({
            error: "Unable to load posts",
        });
    }
});


const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === "string" && UUID_RE.test(value);
}

app.get("/users", verifySupabaseSession, async (req, res) => {
    const search = req.query.search;

    try {
        let usersResult;

        if (search) {
            usersResult = await pool.query(
                `SELECT id, username, created_at
                 FROM users
                 WHERE id != $1
                   AND username ILIKE $2
                 ORDER BY username ASC`,
                [
                    req.user.userId,
                    `%${search}%`,
                ]
            );
        } else {
            usersResult = await pool.query(
                `SELECT id, username, created_at
                 FROM users
                 WHERE id != $1
                 ORDER BY username ASC`,
                [req.user.userId]
            );
        }

        const friendshipsResult = await pool.query(
            `SELECT
                id,
                requester_id,
                receiver_id,
                status
             FROM friendships
             WHERE requester_id = $1
                OR receiver_id = $1`,
            [req.user.userId]
        );

        for (const user of usersResult.rows) {
            user.friendship_status = "none";

            for (const friendship of friendshipsResult.rows) {
                const sentByCurrentUser =
                    friendship.requester_id === req.user.userId &&
                    friendship.receiver_id === user.id;

                const receivedByCurrentUser =
                    friendship.requester_id === user.id &&
                    friendship.receiver_id === req.user.userId;

                if (sentByCurrentUser || receivedByCurrentUser) {
                    if (friendship.status === "accepted") {
                        user.friendship_status = "friends";
                    } else if (sentByCurrentUser) {
                        user.friendship_status = "request-sent";
                    } else {
                        user.friendship_status =
                            "request-received";
                    }

                    break;
                }
            }
        }

        res.json(usersResult.rows);
    } catch (error) {
        console.error("GET /users failed:", error.message);
        res.status(500).json({
            error: "Unable to load users",
        });
    }
});

app.post(
    "/friend-requests",
    verifySupabaseSession,
    async (req, res) => {
        const { receiver_id } = req.body || {};

        if (!isUuid(receiver_id)) {
            return res.status(400).json({
                error: "Valid receiver ID is required",
            });
        }

        if (receiver_id === req.user.userId) {
            return res.status(400).json({
                error:
                    "You cannot send a friend request to yourself",
            });
        }

        try {
            const userResult = await pool.query(
                `SELECT id, username
                 FROM users
                 WHERE id = $1`,
                [receiver_id]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    error: "User not found",
                });
            }

            const existingResult = await pool.query(
                `SELECT
                    id,
                    requester_id,
                    receiver_id,
                    status
                 FROM friendships
                 WHERE (
                    requester_id = $1
                    AND receiver_id = $2
                 )
                 OR (
                    requester_id = $2
                    AND receiver_id = $1
                 )`,
                [
                    req.user.userId,
                    receiver_id,
                ]
            );

            if (existingResult.rows.length > 0) {
                const existing = existingResult.rows[0];

                if (existing.status === "accepted") {
                    return res.status(409).json({
                        error: "You are already friends",
                    });
                }

                if (
                    existing.requester_id ===
                    req.user.userId
                ) {
                    return res.status(409).json({
                        error: "Friend request already sent",
                    });
                }

                return res.status(409).json({
                    error:
                        "This user has already sent you a friend request",
                });
            }

            const result = await pool.query(
                `INSERT INTO friendships
                    (requester_id, receiver_id, status)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [
                    req.user.userId,
                    receiver_id,
                    "pending",
                ]
            );

            res.status(201).json(result.rows[0]);
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).json({
                    error: "Friend request already exists",
                });
            }

            if (error.code === "23503") {
                return res.status(404).json({
                    error: "User not found",
                });
            }

            console.error(
                "POST /friend-requests failed:",
                error.message
            );
            res.status(500).json({
                error: "Unable to send friend request",
            });
        }
    }
);

app.get(
    "/friend-requests",
    verifySupabaseSession,
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT
                    friendships.id,
                    friendships.requester_id,
                    friendships.receiver_id,
                    friendships.status,
                    friendships.created_at,
                    users.username AS requester_username

                 FROM friendships

                 JOIN users
                   ON users.id =
                      friendships.requester_id

                 WHERE friendships.receiver_id = $1
                   AND friendships.status = $2

                 ORDER BY friendships.created_at DESC`,
                [
                    req.user.userId,
                    "pending",
                ]
            );

            res.json(result.rows);
        } catch (error) {
            console.error(
                "GET /friend-requests failed:",
                error.message
            );

            res.status(500).json({
                error: "Unable to load friend requests",
            });
        }
    }
);

app.patch(
    "/friend-requests/:id/accept",
    verifySupabaseSession,
    async (req, res) => {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "Invalid friend request ID",
            });
        }

        try {
            const result = await pool.query(
                `UPDATE friendships
                 SET status = $1
                 WHERE id = $2
                   AND receiver_id = $3
                   AND status = $4
                 RETURNING *`,
                [
                    "accepted",
                    id,
                    req.user.userId,
                    "pending",
                ]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error:
                        "Pending friend request not found",
                });
            }

            res.json(result.rows[0]);
        } catch (error) {
            console.error(
                "PATCH /friend-requests/:id/accept failed:",
                error.message
            );

            res.status(500).json({
                error: "Unable to accept friend request",
            });
        }
    }
);

app.get("/friends", verifySupabaseSession, async (req, res) => {
    try {
        const sentResult = await pool.query(
            `SELECT
                users.id,
                users.username,
                friendships.created_at
                    AS friendship_created_at

             FROM friendships

             JOIN users
               ON users.id = friendships.receiver_id

             WHERE friendships.requester_id = $1
               AND friendships.status = $2`,
            [
                req.user.userId,
                "accepted",
            ]
        );

        const receivedResult = await pool.query(
            `SELECT
                users.id,
                users.username,
                friendships.created_at
                    AS friendship_created_at

             FROM friendships

             JOIN users
               ON users.id = friendships.requester_id

             WHERE friendships.receiver_id = $1
               AND friendships.status = $2`,
            [
                req.user.userId,
                "accepted",
            ]
        );

        const friends = [
            ...sentResult.rows,
            ...receivedResult.rows,
        ];

        res.json(friends);
    } catch (error) {
        console.error("GET /friends failed:", error.message);

        res.status(500).json({
            error: "Unable to load friends",
        });
    }
});
app.get(
    "/exercise-suggestions",
    verifySupabaseSession,
    async (req, res) => {
        const { name, muscle, type, difficulty } = req.query;

        if (!name && !muscle && !type && !difficulty) {
            return res.status(400).json({
                error: "Provide name, muscle, type, or difficulty",
            });
        }

        if (name !== undefined && typeof name !== "string") {
            return res.status(400).json({
                error: "Exercise name must be a string",
            });
        }

        if (muscle !== undefined && typeof muscle !== "string") {
            return res.status(400).json({
                error: "Muscle must be a string",
            });
        }

        if (type !== undefined && typeof type !== "string") {
            return res.status(400).json({
                error: "Exercise type must be a string",
            });
        }

        if (
            difficulty !== undefined &&
            typeof difficulty !== "string"
        ) {
            return res.status(400).json({
                error: "Difficulty must be a string",
            });
        }

        if (!process.env.API_NINJAS_KEY) {
            return res.status(500).json({
                error: "Exercise API key is missing",
            });
        }

        const filters = [];

        if (name && name.trim()) {
            filters.push(`name=${name.trim()}`);
        }

        if (muscle && muscle.trim()) {
            filters.push(`muscle=${muscle.trim()}`);
        }

        if (type && type.trim()) {
            filters.push(`type=${type.trim()}`);
        }

        if (difficulty && difficulty.trim()) {
            filters.push(`difficulty=${difficulty.trim()}`);
        }

        if (filters.length === 0) {
            return res.status(400).json({
                error: "Search value cannot be empty",
            });
        }

        const apiUrl =
            "https://api.api-ninjas.com/v1/exercises?" +
            filters.join("&");

        try {
            const response = await fetch(apiUrl, {
                headers: {
                    "X-Api-Key": process.env.API_NINJAS_KEY,
                },
            });

            if (!response.ok) {
                return res.status(502).json({
                    error: "Exercise service is unavailable",
                });
            }

            const exercises = await response.json();

            res.json(exercises);
        } catch (error) {
            console.error(
                "GET /exercise-suggestions failed:",
                error.message
            );

            res.status(502).json({
                error: "Unable to load exercise suggestions",
            });
        }
    }
);
let freeExerciseCache = null;

app.get(
    "/exercise-images",
    verifySupabaseSession,
    async (req, res) => {
        const {
            name,
            muscle,
            type,
            difficulty,
        } = req.query;

        if (!name && !muscle && !type && !difficulty) {
            return res.status(400).json({
                error:
                    "Provide name, muscle, type, or difficulty",
            });
        }

        try {
            if (!freeExerciseCache) {
                const response = await fetch(
                    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
                );

                if (!response.ok) {
                    return res.status(502).json({
                        error:
                            "Exercise image service is unavailable",
                    });
                }

                freeExerciseCache =
                    await response.json();
            }

            const searchName = name
                ? name.trim().toLowerCase()
                : "";

            const searchMuscle = muscle
                ? muscle
                    .trim()
                    .toLowerCase()
                    .split("_")
                    .join(" ")
                : "";

            const searchType = type
                ? type
                    .trim()
                    .toLowerCase()
                    .split("_")
                    .join(" ")
                : "";

            const searchDifficulty = difficulty
                ? difficulty.trim().toLowerCase()
                : "";

            const results = freeExerciseCache
                .filter((exercise) => {
                    const exerciseName =
                        exercise.name.toLowerCase();

                    const primaryMuscles =
                        exercise.primaryMuscles || [];

                    const secondaryMuscles =
                        exercise.secondaryMuscles || [];

                    const allMuscles = [
                        ...primaryMuscles,
                        ...secondaryMuscles,
                    ].map((item) =>
                        item.toLowerCase()
                    );

                    const nameMatches =
                        !searchName ||
                        exerciseName.includes(
                            searchName
                        );

                    const muscleMatches =
                        !searchMuscle ||
                        allMuscles.includes(
                            searchMuscle
                        );

                    const typeMatches =
                        !searchType ||
                        exercise.category ===
                        searchType;

                    const difficultyMatches =
                        !searchDifficulty ||
                        exercise.level ===
                        searchDifficulty;

                    return (
                        nameMatches &&
                        muscleMatches &&
                        typeMatches &&
                        difficultyMatches
                    );
                })
                .slice(0, 8)
                .map((exercise) => {
                    const imageUrls =
                        exercise.images.map(
                            (imagePath) =>
                                "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/" +
                                imagePath
                        );

                    return {
                        id: exercise.id,
                        name: exercise.name,
                        level: exercise.level,
                        equipment:
                            exercise.equipment,
                        category:
                            exercise.category,
                        primaryMuscles:
                            exercise.primaryMuscles,
                        instructions:
                            exercise.instructions,
                        images: imageUrls,
                    };
                });

            res.json(results);
        } catch (error) {
            console.error(
                "GET /exercise-images failed:",
                error.message
            );

            res.status(502).json({
                error:
                    "Unable to load exercise images",
            });
        }
    }
);
function findFoodNutrient(food, nutrientNames) {
    const nutrients = food.foodNutrients || [];

    const nutrient = nutrients.find((item) =>
        nutrientNames.includes(item.nutrientName)
    );

    if (!nutrient) {
        return {
            value: 0,
            unit: "",
        };
    }

    return {
        value: nutrient.value || 0,
        unit: nutrient.unitName || "",
    };
}

function createIngredientImageUrl(foodName) {
    const imageName = foodName
        .trim()
        .toLowerCase()
        .split(" ")
        .join("_");

    return (
        "https://www.themealdb.com/images/ingredients/" +
        encodeURIComponent(imageName) +
        ".png"
    );
}

app.get(
    "/food-calories",
    verifySupabaseSession,
    async (req, res) => {
        const query = req.query.query;

        if (typeof query !== "string" || !query.trim()) {
            return res.status(400).json({
                error: "Food search is required",
            });
        }

        if (!process.env.USDA_API_KEY) {
            return res.status(500).json({
                error: "USDA API key is missing",
            });
        }

        const cleanQuery = query.trim();

        const apiUrl =
            "https://api.nal.usda.gov/fdc/v1/foods/search" +
            "?api_key=" +
            encodeURIComponent(process.env.USDA_API_KEY) +
            "&query=" +
            encodeURIComponent(cleanQuery) +
            "&pageSize=12";

        try {
            const response = await fetch(apiUrl);

            if (!response.ok) {
                return res.status(502).json({
                    error: "Food nutrition service is unavailable",
                });
            }

            const data = await response.json();

            const foods = (data.foods || []).map((food) => {
                const calories = findFoodNutrient(food, [
                    "Energy",
                ]);

                const protein = findFoodNutrient(food, [
                    "Protein",
                ]);

                const carbohydrates = findFoodNutrient(food, [
                    "Carbohydrate, by difference",
                ]);

                const fat = findFoodNutrient(food, [
                    "Total lipid (fat)",
                ]);

                return {
                    id: food.fdcId,
                    name: food.description,
                    brand: food.brandOwner || null,
                    serving_size: food.servingSize || 100,
                    serving_unit: food.servingSizeUnit || "g",

                    calories: calories.value,
                    calories_unit: calories.unit,

                    protein: protein.value,
                    protein_unit: protein.unit,

                    carbohydrates: carbohydrates.value,
                    carbohydrates_unit:
                        carbohydrates.unit,

                    fat: fat.value,
                    fat_unit: fat.unit,

                    image_url:
                        createIngredientImageUrl(
                            cleanQuery
                        ),
                };
            });

            res.json(foods);
        } catch (error) {
            console.error(
                "GET /food-calories failed:",
                error.message
            );

            res.status(502).json({
                error: "Unable to load food nutrition",
            });
        }
    }
);

function createIngredientList(meal) {
    const ingredients = [];

    for (let number = 1; number <= 20; number++) {
        const ingredient =
            meal[`strIngredient${number}`];

        const measure =
            meal[`strMeasure${number}`];

        if (ingredient && ingredient.trim()) {
            ingredients.push({
                name: ingredient.trim(),
                measure: measure
                    ? measure.trim()
                    : "",
            });
        }
    }

    return ingredients;
}

app.get(
    "/meal-ideas",
    verifySupabaseSession,
    async (req, res) => {
        const search = req.query.search;

        if (
            typeof search !== "string" ||
            !search.trim()
        ) {
            return res.status(400).json({
                error: "Meal search is required",
            });
        }

        const apiUrl =
            "https://www.themealdb.com/api/json/v1/1/search.php?s=" +
            encodeURIComponent(search.trim());

        try {
            const response = await fetch(apiUrl);

            if (!response.ok) {
                return res.status(502).json({
                    error: "Meal service is unavailable",
                });
            }

            const data = await response.json();

            const meals = (data.meals || []).map(
                (meal) => ({
                    id: meal.idMeal,
                    name: meal.strMeal,
                    category: meal.strCategory,
                    country: meal.strArea,
                    image_url: meal.strMealThumb,
                    instructions:
                        meal.strInstructions,
                    video_url:
                        meal.strYoutube || null,
                    ingredients:
                        createIngredientList(meal),
                })
            );

            res.json(meals);
        } catch (error) {
            console.error(
                "GET /meal-ideas failed:",
                error.message
            );

            res.status(502).json({
                error: "Unable to load meal ideas",
            });
        }
    }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
