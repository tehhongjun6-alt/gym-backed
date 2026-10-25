require("dotenv").config();

const express = require("express");
const cors = require("cors");

// 使用刚刚建立的数据库连接和 Supabase 客户端
const { pool } = require("./db");
const {
    supabase,
    supabaseAdmin,
} = require("./supabaseClient");

const app = express();

app.use(cors());
app.use(express.json());

// 检查服务器是否运行
app.get("/", (req, res) => {
    res.json({
        message: "Gym Tracker API is running",
    });
});

// 注册账号
app.post("/auth/signup", async (req, res) => {
    const { username, email, password } = req.body || {};

    // 检查用户名
    if (typeof username !== "string" || !username.trim()) {
        return res.status(400).json({
            error: "Username is required",
        });
    }

    // 检查邮箱
    if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
            error: "Email is required",
        });
    }

    // 密码不使用 trim，避免改变用户输入的密码
    if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({
            error: "Password must contain at least 6 characters",
        });
    }

    try {
        // 第一步：让 Supabase Auth 创建账号
        // 密码由 Supabase 处理，不写进 public.users
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

        // 第二步：将 Auth 的 UUID 和用户名保存到 users 表
        // $1、$2 是参数占位符，不直接拼接用户输入
        const result = await pool.query(
            `INSERT INTO users (id, username)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
            [data.user.id, username.trim()]
        );

        // 是否马上获得 session，取决于邮箱确认设置
        res.status(201).json({
            message: data.session
                ? "Account created successfully"
                : "Account created. Check your email to confirm.",
            user: result.rows[0],
            session: data.session,
        });
    } catch (error) {
        console.error("POST /auth/signup failed:", error.message);

        // Auth 创建账号和保存资料是两个步骤
        // 保存资料失败，不代表前面的 Auth 账号没有建立
        res.status(500).json({
            error:
                "Unable to complete registration. An Auth account may already have been created.",
        });
    }
});
// 邮箱和密码登录
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};

    // 检查有没有填写邮箱
    if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({
            error: "Email is required",
        });
    }

    // 检查有没有填写密码，不改变密码本身
    if (typeof password !== "string" || !password) {
        return res.status(400).json({
            error: "Password is required",
        });
    }

    try {
        // 让 Supabase 验证邮箱和密码
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });

        // 登录失败
        if (error) {
            return res.status(401).json({
                error: error.message,
            });
        }

        // 确认成功取得登录 session
        if (!data.session) {
            return res.status(401).json({
                error: "Unable to create a login session",
            });
        }

        // 返回 session，里面包含 access_token
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
// 验证 access token
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

// 获取当前登录用户
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

// 新增自己的训练记录
app.post("/workouts", verifySupabaseSession, async (req, res) => {
    const {
        workout_date,
        exercise_name,
        sets,
        reps,
        weight,
    } = req.body || {};

    // 日期不能为空，前端使用 YYYY-MM-DD 格式
    if (typeof workout_date !== "string" || !workout_date.trim()) {
        return res.status(400).json({
            error: "Workout date is required",
        });
    }

    // 动作名称不能为空
    if (typeof exercise_name !== "string" || !exercise_name.trim()) {
        return res.status(400).json({
            error: "Exercise name is required",
        });
    }

    // 组数必须是大于 0 的整数
    if (!Number.isInteger(sets) || sets <= 0) {
        return res.status(400).json({
            error: "Sets must be a positive integer",
        });
    }

    // 每组次数必须是大于 0 的整数
    if (!Number.isInteger(reps) || reps <= 0) {
        return res.status(400).json({
            error: "Reps must be a positive integer",
        });
    }

    // 重量必须是数字，0 代表不额外负重
    // 上限对应数据库 NUMERIC(7, 2) 字段
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
         (user_id, workout_date, exercise_name, sets, reps, weight)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [
                // 使用 token 验证后的身份，不接受前端指定 user_id
                req.user.userId,
                workout_date.trim(),
                exercise_name.trim(),
                sets,
                reps,
                weight,
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        // 数据库拒绝不存在的日期或超出范围的数字
        if (
            error.code === "22007" ||
            error.code === "22008" ||
            error.code === "22003"
        ) {
            return res.status(400).json({
                error: "Check the workout date and numeric values",
            });
        }

        // Auth 账号存在，但 users 表没有对应的资料
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

// 查看自己的训练记录
app.get("/workouts", verifySupabaseSession, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
       FROM workouts
       WHERE user_id = $1
       ORDER BY workout_date DESC, id DESC`,
            [req.user.userId]
        );

        // 没有记录时返回 []，不属于错误
        res.json(result.rows);
    } catch (error) {
        console.error("GET /workouts failed:", error.message);

        res.status(500).json({
            error: "Unable to load workouts",
        });
    }
});
// 修改自己的训练记录
app.patch("/workouts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    // 数据库的记录 ID 必须是有效的正整数
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid workout ID",
        });
    }

    const {
        workout_date,
        exercise_name,
        sets,
        reps,
        weight,
    } = req.body || {};

    // 至少提供一个需要修改的字段
    if (
        workout_date === undefined &&
        exercise_name === undefined &&
        sets === undefined &&
        reps === undefined &&
        weight === undefined
    ) {
        return res.status(400).json({
            error: "Provide at least one field to update",
        });
    }

    // PATCH 只检查用户有提供的字段
    if (
        workout_date !== undefined &&
        (typeof workout_date !== "string" || !workout_date.trim())
    ) {
        return res.status(400).json({
            error: "Workout date cannot be empty",
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
        // COALESCE：没有提供新值的字段，保留原本的值
        // 必须同时匹配记录 ID 和当前用户 ID
        const result = await pool.query(
            `UPDATE workouts
       SET workout_date = COALESCE($1, workout_date),
           exercise_name = COALESCE($2, exercise_name),
           sets = COALESCE($3, sets),
           reps = COALESCE($4, reps),
           weight = COALESCE($5, weight)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
            [
                workout_date === undefined ? null : workout_date.trim(),
                exercise_name === undefined ? null : exercise_name.trim(),
                sets,
                reps,
                weight,
                id,
                req.user.userId,
            ]
        );

        // 不存在或不属于自己的记录，都不允许修改
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

// 删除自己的训练记录
app.delete("/workouts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid workout ID",
        });
    }

    try {
        // 即使知道别人的记录 ID，也不能删除
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
// 为 private Storage 图片建立临时 signed URL
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
// 清理上传成功但没有被帖子使用的图片
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

    // 用户只能清理自己 UUID 文件夹中的图片
    if (!cleanImagePath.startsWith(userFolder)) {
      return res.status(403).json({
        error: "You cannot delete this image",
      });
    }

    try {
      // 已经属于帖子的图片不能通过此接口删除
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

// 发布健身动态
app.post("/posts", verifySupabaseSession, async (req, res) => {
    const {
        content,
        visibility = "public",
        image_url,
        image_path,
    } = req.body || {};

    // 帖子必须有文字内容
    if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({
            error: "Post content is required",
        });
    }

    // 只接受这两种可见范围
    if (visibility !== "public" && visibility !== "friends-only") {
        return res.status(400).json({
            error: "Visibility must be public or friends-only",
        });
    }

    // 图片可以不传；有传时必须是字符串
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
                // 作者身份必须来自已验证的 token
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


// 登录后读取自己有权限查看的动态
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

        // 没有动态时返回空数组
        // 只为已经通过帖子权限检查的动态建立图片链接
        const posts = await addSignedImageUrls(
            result.rows
        );

        // 没有动态时返回空数组
        res.json(posts);
    } catch (error) {
        console.error("GET /posts failed:", error.message);

        res.status(500).json({
            error: "Unable to load posts",
        });
    }
});
// 修改自己的帖子
app.patch("/posts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid post ID",
        });
    }

    const { content, visibility } = req.body || {};

    // 至少提供一个需要修改的字段
    if (content === undefined && visibility === undefined) {
        return res.status(400).json({
            error: "Provide content or visibility to update",
        });
    }

    if (
        content !== undefined &&
        (typeof content !== "string" || !content.trim())
    ) {
        return res.status(400).json({
            error: "Post content cannot be empty",
        });
    }

    if (
        visibility !== undefined &&
        visibility !== "public" &&
        visibility !== "friends-only"
    ) {
        return res.status(400).json({
            error: "Visibility must be public or friends-only",
        });
    }

    try {
        // 没有提供的字段保持原值
        // 只能修改属于当前用户的帖子
        const result = await pool.query(
            `UPDATE posts
       SET content = COALESCE($1, content),
           visibility = COALESCE($2, visibility)
       WHERE id = $3 AND author_id = $4
       RETURNING *`,
            [
                content === undefined ? null : content.trim(),
                visibility,
                id,
                req.user.userId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Post not found",
            });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("PATCH /posts failed:", error.message);

        res.status(500).json({
            error: "Unable to update post",
        });
    }
});

// 删除自己的帖子
app.delete("/posts/:id", verifySupabaseSession, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            error: "Invalid post ID",
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM posts
       WHERE id = $1 AND author_id = $2
       RETURNING id, image_path`,
            [id, req.user.userId]
        );

        // 不存在或不属于当前用户，都不能删除
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Post not found",
            });
        }

        const imagePath =
            result.rows[0].image_path;

        // 帖子删除成功后，清理对应的 Storage 图片
        if (imagePath) {
            const {
                error: storageError,
            } = await supabaseAdmin.storage
                .from("post-images")
                .remove([imagePath]);

            if (storageError) {
                console.error(
                    "Unable to delete post image:",
                    storageError.message
                );
            }
        }

        res.json({
            message: "Post deleted successfully",
            id: result.rows[0].id,
        });
    } catch (error) {
        console.error("DELETE /posts failed:", error.message);

        res.status(500).json({
            error: "Unable to delete post",
        });
    }
});

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === "string" && UUID_RE.test(value);
}

// 显示或搜索其他用户
app.get("/users", verifySupabaseSession, async (req, res) => {
    const search = req.query.search;

    try {
        let usersResult;

        // 有 search query 时，根据用户名搜索
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
            // 没有 search query 时，显示所有其他用户
            usersResult = await pool.query(
                `SELECT id, username, created_at
                 FROM users
                 WHERE id != $1
                 ORDER BY username ASC`,
                [req.user.userId]
            );
        }

        // 找出当前用户已有的好友关系或申请
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

        // 给每一位用户加入当前的好友状态
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

// 发送好友申请
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
            // 确认要添加的用户存在
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

            // 检查两个方向有没有现有申请或好友关系
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

// 查看自己收到的好友申请
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

// 接受好友申请
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

// 查看好友列表
app.get("/friends", verifySupabaseSession, async (req, res) => {
    try {
        // 当前用户是申请发送者
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

        // 当前用户是申请接收者
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
// 从 API Ninjas 搜索健身动作
app.get(
    "/exercise-suggestions",
    verifySupabaseSession,
    async (req, res) => {
        const { name, muscle, type, difficulty } = req.query;

        // 至少需要一个搜索条件
        if (!name && !muscle && !type && !difficulty) {
            return res.status(400).json({
                error: "Provide name, muscle, type, or difficulty",
            });
        }

        // 检查查询参数
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

        // 检查服务器有没有 API key
        if (!process.env.API_NINJAS_KEY) {
            return res.status(500).json({
                error: "Exercise API key is missing",
            });
        }

        // 建立 API 查询参数
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
// 暂时保存 free-exercise-db 的动作资料
// 服务器重新启动后会重新下载一次
let freeExerciseCache = null;

// 从 free-exercise-db 搜索带图片的健身动作
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

        // 至少需要一个搜索条件
        if (!name && !muscle && !type && !difficulty) {
            return res.status(400).json({
                error:
                    "Provide name, muscle, type, or difficulty",
            });
        }

        try {
            // 第一次搜索时才下载资料
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

            // 前端使用 lower_back，
            // 数据集使用 lower back
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
