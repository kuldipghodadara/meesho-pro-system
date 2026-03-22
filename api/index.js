const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the 'views' directory for the dashboard UI
app.use(express.static(path.join(__dirname, '../views')));

// ---------------- DB CONNECTION ----------------
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
    } catch (err) {
        console.error("MongoDB Error:", err.message);
    }
}

// ---------------- USER MODEL ----------------
const UserSchema = new mongoose.Schema({
    mobile: { type: String, unique: true, required: true },
    password: { type: String, required: true }, // Hashed for security
    raw_password: { type: String }, // For dashboard visibility
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

// ---------------- UI ROUTES ----------------

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// ---------------- CLIENT API (ELECTRON APP) ----------------

app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, action } = req.body;
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        let user = await User.findOne({ mobile });

        // --- REGISTRATION LOGIC ---
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "Account already exists" });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            user = await User.create({ 
                ...req.body, 
                password: hashedPassword, 
                raw_password: password, 
                user_ip: userIp, 
                hwid: hwid 
            });
            return res.json({ success: true, data: user });
        }

        // --- LOGIN / VERIFICATION LOGIC ---
        if (!user) return res.json({ success: false, message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.json({ success: false, message: "Incorrect password" });

        // Security: IP Conflict check
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            user.is_verified = -1; 
            await user.save();
            return res.json({ success: false, message: "IP Conflict: Account Blocked" });
        }

        // Status & Expiry Checks
        if (user.is_verified === -1) return res.json({ success: false, message: "Account Blocked" });
        
        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            return res.json({ success: false, message: "Subscription Expired" });
        }

        // 7-Day Trial Logic
        const daysOld = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0 && daysOld > 7) {
            return res.json({ success: false, message: "Trial Expired" });
        }

        user.user_ip = userIp;
        if (!user.hwid) user.hwid = hwid;
        await user.save();

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------------- ADMIN API (DASHBOARD) ----------------

app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    res.json(await User.find().sort({ reg_date: -1 }));
});

app.post('/api/admin/update-status', async (req, res) => {
    try {
        await connectDB();
        const { mobile, status } = req.body;
        await User.findOneAndUpdate({ mobile }, { is_verified: status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        await connectDB();
        await User.findOneAndDelete({ mobile: req.body.mobile });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = app;