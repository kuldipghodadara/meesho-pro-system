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

// ---------------- CLIENT API: VERIFY ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, hwid } = req.body;
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        let user = await User.findOne({ mobile });

        // Security: Block if different mobile uses same IP
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            if (user) { user.is_verified = -1; await user.save(); }
            return res.json({ success: false, message: "Security Alert: IP Conflict." });
        }

        if (!user) {
            user = await User.create({ ...req.body, user_ip: userIp, is_verified: 0 });
        } else {
            user.user_ip = userIp;
            if (!user.hwid) user.hwid = hwid;
            await user.save();
        }

        // Auto-Block Logic for Expiry
        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            user.is_verified = -1;
            await user.save();
            return res.json({ success: false, message: "Subscription Expired." });
        }

        if (user.is_verified === -1) return res.json({ success: false, message: "Account Blocked." });

        // 7-Day Trial Logic
        const daysOld = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0 && daysOld > 7) {
            return res.json({ success: false, message: "Trial Expired." });
        }

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

app.post('/api/admin/delete-user', async (req, res) => {
    await connectDB();
    await User.findOneAndDelete({ mobile: req.body.mobile });
    res.json({ success: true });
});

module.exports = app;