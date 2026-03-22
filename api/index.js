const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Install using: npm install bcryptjs

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the 'views' directory
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
    password: { type: String, required: true }, // Encrypted
    seller_name: String,
    gst_number: String,
    email: String,
    hwid: String,
    user_ip: String,
    plan: { type: String, default: "Trial" }, 
    is_verified: { type: Number, default: 0 },
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null } 
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- ROUTES ----------------

// Fix: Serve the dashboard.html file when /dashboard is accessed
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, action } = req.body;
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        let user = await User.findOne({ mobile });

        // --- REGISTRATION LOGIC WITH PASSWORD ENCRYPTION ---
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "Account already exists" });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            user = await User.create({ 
                ...req.body, 
                password: hashedPassword, 
                user_ip: userIp, 
                hwid: hwid 
            });
            return res.json({ success: true, data: user });
        }

        // --- LOGIN LOGIC WITH PASSWORD CHECK ---
        if (!user) return res.json({ success: false, message: "User not found" });

        // Compare provided password with hashed password in DB
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.json({ success: false, message: "Incorrect password" });

        // Security: IP Conflict check
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            user.is_verified = -1; 
            await user.save();
            return res.json({ success: false, message: "IP Conflict: Account Blocked" });
        }

        user.user_ip = userIp;
        if (!user.hwid) user.hwid = hwid;
        await user.save();

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ADD THIS DELETE ROUTE ---
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        await connectDB();
        const { mobile } = req.body;
        
        if (!mobile) {
            return res.status(400).json({ success: false, message: "Mobile number required" });
        }

        const result = await User.findOneAndDelete({ mobile });
        
        if (result) {
            res.json({ success: true, message: "User deleted successfully" });
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin APIs
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    res.json(await User.find().sort({ reg_date: -1 }));
});

module.exports = app;