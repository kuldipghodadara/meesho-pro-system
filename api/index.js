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
// api/index.js
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, action } = req.body;

        // 1. Check if user exists
        let user = await User.findOne({ mobile });

        // 2. LOGOUT ACTION
        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        // 3. LOGIN / HEARTBEAT ACTION (The Fix)
        if (action === 'login') {
            if (!user) {
                // Return failure if user was deleted. DO NOT CREATE NEW USER.
                return res.json({ success: false, message: "Account deleted or not found." });
            }
            if (password && user.password !== password) {
                return res.json({ success: false, message: "Invalid credentials." });
            }
            if (user.is_verified === -1) {
                return res.json({ success: false, message: "Account blocked by admin." });
            }

            // User is valid, update online status
            user.is_online = true;
            await user.save();
            return res.json({ success: true, data: user });
        }

        // 4. REGISTER ACTION (Only this creates new users)
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "User already exists." });

            const newUser = new User({
                mobile,
                password,
                seller_name: req.body.seller_name,
                gst_number: req.body.gst_number,
                email: req.body.email,
                is_verified: 0, 
                is_online: true
            });
            await newUser.save();
            return res.json({ success: true, data: newUser });
        }

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

// THIS WAS THE MISSING ROUTE CAUSING THE 404
app.post('/api/admin/update-subscription', async (req, res) => {
    try {
        await connectDB();
        const { mobile, plan, expiry_date } = req.body;
        await User.findOneAndUpdate(
            { mobile }, 
            { plan, expiry_date, is_verified: 1 }, 
            { new: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;