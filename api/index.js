

// const express = require('express');
// const sqlite3 = require('sqlite3').verbose();
// const cors = require('cors');
// const bodyParser = require('body-parser');
// const fs = require('fs');

// const app = express();
// const port = 3000;
// const dbPath = './data/database.sqlite';

// // Ensure data directory exists
// if (!fs.existsSync('./data')) {
//     fs.mkdirSync('./data');
// }

// const db = new sqlite3.Database(dbPath);

// app.use(cors());
// app.use(bodyParser.json());

// // Initialize Database with 9-column structure
// db.serialize(() => {
//     db.run(`CREATE TABLE IF NOT EXISTS users (
//         mobile TEXT PRIMARY KEY, 
//         password TEXT, 
//         hwid TEXT, 
//         ip TEXT, 
//         reg_date DATETIME, 
//         is_verified INTEGER DEFAULT 0,
//         seller_name TEXT, 
//         gst_number TEXT, 
//         email TEXT
//     )`);
// });

// // --- MAIN AUTH & PROFILE UPDATE ROUTE ---
// app.post('/api/verify', (req, res) => {
//     const { mobile, password, hwid, seller_name, gst_number, email } = req.body;
//     const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";

//     db.get("SELECT * FROM users WHERE mobile = ?", [mobile], (err, user) => {
//         if (err) return res.status(500).json({ success: false, message: "Database Error" });

//         if (!user) {
//             // 1. REGISTER NEW USER
//             const now = new Date().toISOString();
//             const insertSql = `INSERT INTO users (mobile, password, hwid, ip, reg_date, is_verified, seller_name, gst_number, email) 
//                                VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`;
            
//             db.run(insertSql, [mobile, password, hwid, ip, now, seller_name || '', gst_number || '', email || ''], (err) => {
//                 if (err) return res.json({ success: false, message: "Registration Failed: " + err.message });
//                 return res.json({ 
//                     success: true, 
//                     message: "User Registered Successfully",
//                     data: { mobile, seller_name, gst_number, email } 
//                 });
//             });
//         } else {
//             // 2. UPDATE PROFILE & SYNC WITH MANAGEMENT PANEL
//             // This part ensures that if a user changes their details in the app, it reflects in the DB
//             const updateSql = `UPDATE users SET 
//                                seller_name = ?, 
//                                gst_number = ?, 
//                                email = ?, 
//                                ip = ?, 
//                                hwid = ? 
//                                WHERE mobile = ?`;
            
//             db.run(updateSql, [
//                 seller_name || user.seller_name, 
//                 gst_number || user.gst_number, 
//                 email || user.email, 
//                 ip, 
//                 hwid, 
//                 mobile
//             ], (err) => {
//                 if (err) return res.json({ success: false, message: "Update Failed" });

//                 // Check if Blocked by Admin
//                 if (user.is_verified === -1) {
//                     return res.json({ success: false, message: "Access Denied: Account Blocked" });
//                 }

//                 // Return Success + Updated Data to the App
//                 res.json({ 
//                     success: true, 
//                     message: "Session Verified & Profile Synced",
//                     data: { 
//                         mobile: mobile,
//                         seller_name: seller_name || user.seller_name,
//                         gst_number: gst_number || user.gst_number,
//                         email: email || user.email,
//                         status: user.is_verified
//                     } 
//                 });
//             });
//         }
//     });
// });

// // --- ADMIN PANEL ROUTES ---

// // Fetch all users for management
// app.get('/api/admin/users', (req, res) => {
//     db.all("SELECT * FROM users ORDER BY reg_date DESC", [], (err, rows) => {
//         if (err) return res.status(500).json([]);
//         res.json(rows);
//     });
// });

// // Admin Action: Verify or Block
// app.post('/api/admin/update', (req, res) => {
//     const { mobile, action } = req.body;
//     const status = (action === 'verify') ? 1 : -1;

//     db.run("UPDATE users SET is_verified = ? WHERE mobile = ?", [status, mobile], (err) => {
//         if (err) return res.json({ success: false });
//         res.json({ success: true });
//     });
// });

// // Clear DB (Use with caution)
// app.post('/api/admin/reset', (req, res) => {
//     db.run("DELETE FROM users", (err) => {
//         if (err) return res.json({ success: false });
//         res.json({ success: true, message: "All user data cleared." });
//     });
// });

// app.listen(port, () => {
//     console.log(`✅ Meesho Pro Server running on http://localhost:${port}`);
// });

// At the bottom of your file, replace app.listen with:const express = require('express');
const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from "public"
app.use(express.static(path.join(__dirname, '../public')));

// --- DATABASE CONNECTION CACHING (Crucial for Vercel) ---
let isConnected = false;

const connectDB = async () => {
    if (isConnected) return;
    try {
        const db = await mongoose.connect(process.env.MONGODB_URI);
        isConnected = db.connections[0].readyState;
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
};

// --- USER MODEL ---
const UserSchema = new mongoose.Schema({
    mobile: String,
    seller_name: String,
    is_verified: { type: Number, default: 0 },
    reg_date: { type: Date, default: Date.now }
});

// Avoid "OverwriteModelError" in serverless environments
const User = mongoose.models.User || mongoose.model('User', UserSchema);

// --- ADMIN ROUTES ---

// 1. Serve the Dashboard HTML
app.get('/dashboard', (req, res) => {
    // Note: Use ../views because this file is inside the /api folder
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// 2. API to get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB(); // Ensure connection is active
        const users = await User.find().sort({ reg_date: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. API to Verify/Block a user
app.post('/api/admin/update-status', async (req, res) => {
    try {
        await connectDB(); // Ensure connection is active
        const { mobile, status } = req.body;
        await User.findOneAndUpdate({ mobile }, { is_verified: status });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Root Health Check
app.get('/', (req, res) => res.send("Management API is Live"));

module.exports = app;