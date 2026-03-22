const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const requestIp = require('request-ip');

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestIp.mw());

// ---------------- DB CONNECTION ----------------
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
    } catch (err) { console.error("DB Error", err); }
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
    is_verified: { type: Number, default: 0 }, 
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null },
    loginAttempts: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    lastLogin: Date
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- ROUTES ----------------

// Serve Admin Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// Client Login & Registration
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, seller_name, gst_number, email } = req.body;
        const clientIp = req.clientIp;

        let user = await User.findOne({ mobile });

        if (!user) {
            const ipCount = await User.countDocuments({ user_ip: clientIp });
            if (ipCount >= 2) return res.status(429).json({ success: false, message: "IP Registration Limit Reached." });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            user = await User.create({ 
                mobile, password: hashedPassword, seller_name, gst_number, email, user_ip: clientIp, hwid 
            });
        }

        if (user.isBlocked) return res.status(403).json({ success: false, message: "Too many attempts. Account Blocked." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.loginAttempts += 1;
            if (user.loginAttempts >= 5) user.isBlocked = true;
            await user.save();
            return res.status(401).json({ success: false, message: "Invalid Password." });
        }

        if (user.hwid && hwid && user.hwid !== hwid) {
            return res.status(403).json({ success: false, message: "Hardware mismatch (Different PC)." });
        }

        user.loginAttempts = 0;
        user.lastLogin = new Date();
        user.user_ip = clientIp;
        await user.save();

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin APIs
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    res.json(await User.find().sort({ reg_date: -1 }));
});

app.post('/api/admin/update-status', async (req, res) => {
    await connectDB();
    const { mobile, status } = req.body;
    await User.findOneAndUpdate({ mobile }, { is_verified: status, isBlocked: status === -1, loginAttempts: 0 });
    res.json({ success: true });
});

module.exports = app;