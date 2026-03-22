const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Recommended for password security

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- DB CONNECTION ----------------
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
    } catch (err) {
        console.error("MongoDB Connection Error:", err.message);
    }
}

// ---------------- USER MODEL ----------------
const UserSchema = new mongoose.Schema({
    mobile: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    seller_name: String,
    gst_number: String,
    email: String,
    hwid: String,
    user_ip: String,
    plan: { type: String, default: "Trial" }, 
    is_verified: { type: Number, default: 0 }, // 0=Trial, 1=Active, -1=Blocked
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null } 
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- CLIENT API: VERIFY ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, action } = req.body;
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        let user = await User.findOne({ mobile });

        // Security: Block if different mobile uses same IP
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            if (user) { user.is_verified = -1; await user.save(); }
            return res.json({ success: false, message: "Security Alert: IP Conflict Detected." });
        }

        // --- REGISTRATION LOGIC ---
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "Account already exists. Please login." });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            user = await User.create({ 
                ...req.body, 
                password: hashedPassword, 
                user_ip: userIp, 
                hwid: hwid,
                is_verified: 0 
            });
            return res.json({ success: true, data: user });
        }

        // --- LOGIN / VERIFICATION LOGIC ---
        if (!user) return res.json({ success: false, message: "Account not found." });

        // Validate Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.json({ success: false, message: "Incorrect password." });

        // Update session info
        user.user_ip = userIp;
        if (!user.hwid) user.hwid = hwid;
        await user.save();

        // Security Checks
        if (user.is_verified === -1) return res.json({ success: false, message: "Account Blocked." });

        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            user.is_verified = -1;
            await user.save();
            return res.json({ success: false, message: "Subscription Expired." });
        }

        // 7-Day Trial Logic
        const daysOld = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0 && daysOld > 7) {
            return res.json({ success: false, message: "Trial Expired. Contact admin for activation." });
        }

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error: " + err.message });
    }
});

// ---------------- ADMIN APIs ----------------
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    const users = await User.find().sort({ reg_date: -1 });
    res.json(users);
});

app.post('/api/admin/update-subscription', async (req, res) => {
    await connectDB();
    const { mobile, plan, expiry_date } = req.body;
    await User.findOneAndUpdate({ mobile }, { plan, expiry_date, is_verified: 1 });
    res.json({ success: true });
});

app.post('/api/admin/update-status', async (req, res) => {
    await connectDB();
    const { mobile, status } = req.body;
    await User.findOneAndUpdate({ mobile }, { is_verified: status });
    res.json({ success: true });
});

module.exports = app;