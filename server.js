const express = require('express');
const { createClient } = require('redis');
const {createServer} = require('redis')
const app = express();
// Middleware bắt buộc để Express hiểu được dữ liệu JSON gửi lên từ PUT/POST
app.use(express.json()); 
const port = 3000;

// 1. Khởi tạo Redis Client
const redisClient = createClient({
    url: 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis successfully!'));

// --- GIẢ LẬP DATABASE ---
const fakeDB = {
    "1": { id: "1", name: "John Doe", role: "Software Engineer", projects: ["mylongAI", "Real Estate Platform"] }
};

// Hàm mô phỏng đọc Database chậm (2 giây)
const fetchFromDB = async (userId) => {
    return new Promise((resolve) => {
        setTimeout(() => resolve(fakeDB[userId]), 2000); 
    });
};

// Hàm mô phỏng ghi Database (0.5 giây)
const updateDB = async (userId, newName) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (fakeDB[userId]) {
                fakeDB[userId].name = newName;
                resolve(fakeDB[userId]);
            } else {
                resolve(null);
            }
        }, 500);
    });
};
// ------------------------

// [API ĐỌC DỮ LIỆU] - Pattern Cache-Aside
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `user:profile:${id}`;

    try {
        const cachedData = await redisClient.get(cacheKey);

        if (cachedData) {
            console.log(`[GET - CACHE HIT] Trả về Redis cho user ${id}`);
            return res.json({ source: 'Redis Cache', data: JSON.parse(cachedData) });
        }

        console.log(`[GET - CACHE MISS] Truy vấn DB cho user ${id}...`);
        const dbData = await fetchFromDB(id);

        if (!dbData) return res.status(404).json({ message: "User not found" });

        // Lưu Cache 60s
        await redisClient.set(cacheKey, JSON.stringify(dbData), { EX: 60 });

        return res.json({ source: 'Database', data: dbData });
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

// [API CẬP NHẬT DỮ LIỆU] - Pattern Cache Invalidation
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { newName } = req.body; // Lấy tên mới từ Postman
    const cacheKey = `user:profile:${id}`;

    try {
        console.log(`[PUT] Đang cập nhật DB cho user ${id} thành "${newName}"...`);
        
        // BƯỚC 1: Cập nhật Database trước
        const updatedUser = await updateDB(id, newName);
        if (!updatedUser) return res.status(404).json({ message: "User not found" });

        // BƯỚC 2: Xóa Cache (Cache Invalidation)
        // Đây là dòng code quyết định việc hệ thống có bị Stale Data hay không!
        await redisClient.del(cacheKey);
        console.log(`[PUT - CACHE INVALIDATED] Đã xóa key ${cacheKey} khỏi Redis.`);

        return res.json({
            message: "Cập nhật thành công và đã xóa Cache",
            data: updatedUser
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Chạy server
app.listen(port, async () => {
    await redisClient.connect();
    console.log(`PoC Server đang chạy tại http://localhost:${port}`);
});