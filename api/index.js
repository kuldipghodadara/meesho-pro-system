const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- DB CONNECTION ----------------
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
        const db = await mongoose.connect(process.env.MONGODB_URI);
        isConnected = db.connections[0].readyState;
    } catch (err) {
        console.error("MongoDB Error:", err.message);
    }
}

// ---------------- USER MODEL ----------------
const UserSchema = new mongoose.Schema({
    mobile: String,
    password: { type: String, default: "" },
    seller_name: String,
    gst_number: String,
    email: String,
    hwid: String,
    user_ip: String,
    is_online: { type: Boolean, default: false }, // NEW: Status tracking
    plan: { type: String, default: "Trial" }, 
    is_verified: { type: Number, default: 0 }, // 0=Trial, 1=Active, -1=Blocked
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null } 
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- DASHBOARD ROUTE ----------------
app.get('/dashboard', (req, res) => {
    try {
        const filePath = path.join(process.cwd(), 'views', 'dashboard.html');
        res.setHeader('Content-Type', 'text/html');
        res.send(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
        res.status(500).send("Dashboard Load Error");
    }
});

// ---------------- CLIENT API: VERIFY & AUTO-BLOCK ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, action } = req.body;
        
        // --- NATIVE IPV6 EXTRACTION ---
        let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        let userIp = rawIp.includes(',') ? rawIp.split(',')[0].trim() : rawIp;
        
        // Check if IP is a Native IPv6 (Contains ':' but no '.')
        const isNativeIpv6 = userIp.includes(':') && !userIp.includes('.');

        let user = await User.findOne({ mobile });

        // --- AUTO-BLOCK LOGIC (Strictly Native IPv6) ---
        if (isNativeIpv6) {
            const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
            if (ipConflict) {
                if (user) { 
                    user.is_verified = -1; 
                    user.is_online = false;
                    await user.save(); 
                }
                return res.json({ success: false, message: "Security Alert: IPv6 Conflict. Account Blocked." });
            }
        }

        // Handle Logout
        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        if (!user) {
            user = await User.create({ ...req.body, user_ip: userIp, is_verified: 0, is_online: true });
        } else {
            // Check credentials if logging in
            if (password && user.password !== password) {
                return res.json({ success: false, message: "Wrong Password" });
            }
            user.user_ip = userIp;
            user.is_online = true; // Mark as online
            if (!user.hwid) user.hwid = hwid;
            await user.save();
        }

        // Auto-Block Logic (Expiry)
        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            user.is_verified = -1;
            user.is_online = false;
            await user.save();
            return res.json({ success: false, message: "Subscription Expired." });
        }

        if (user.is_verified === -1) return res.json({ success: false, message: "Account Blocked." });

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------------- ADMIN APIs ----------------
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    res.json(await User.find().sort({ reg_date: -1 }));
});

app.post('/api/admin/update-status', async (req, res) => {
    await connectDB();
    const { mobile, status } = req.body;
    await User.findOneAndUpdate({ mobile }, { is_verified: status });
    res.json({ success: true });
});

app.post('/api/admin/delete-user', async (req, res) => {
    await connectDB();
    await User.findOneAndDelete({ mobile: req.body.mobile });
    res.json({ success: true });
});

module.exports = app;