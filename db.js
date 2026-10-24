// 加载 .env
require("dotenv").config();

const { Pool } = require("pg");

// 建立 PostgreSQL 连接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    // 沿用课程的开发练习配置
    // 连接会加密，但不验证服务器证书；正式上线前需要调整
    ssl: {
        rejectUnauthorized: false,
    },
});

// 让其他文件可以使用 pool 查询数据库
module.exports = { pool };