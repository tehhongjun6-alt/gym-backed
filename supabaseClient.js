// 加载 .env
require("dotenv").config();

const {
    createClient,
} = require("@supabase/supabase-js");

// 普通 Supabase 客户端
// 使用 publishable key 处理登录和验证用户
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY
);

// 后端管理员客户端
// 只在服务器使用，用来处理 private Storage 图片
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

// 让其他文件可以使用两个 Supabase 客户端
module.exports = {
    supabase,
    supabaseAdmin,
};
