// 加载 .env
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

// 建立 Supabase 客户端
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY
);

// 让其他文件可以使用 supabase
module.exports = { supabase };