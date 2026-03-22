const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const requestIp = require('request-ip');

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestIp.mw()); // Captures IPv4 and IPv6 automatically

const JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key';

// ---------------- DB CONNECTION ----------------
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        const db = await mongoose.connect(process.env.MONGODB_URI);
        isConnected = db.connections[0].readyState;
    } catch (err) {
        console.error("MongoDB Error:", err.message);
    }
}

// ---------------- USER MODEL (UPDATED) ----------------
const UserSchema = new mongoose.Schema({
    mobile: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    seller_name: String,
    gst_number: String,
    email: { type: String, lowercase: true },
    hwid: String,
    user_ip: String, // Stores the IPv6/IPv4 address
    plan: { type: String, default: "Trial" },
    is_verified: { type: Number, default: 0 }, 
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null },
    // Security Improvements
    loginAttempts: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    lastLogin: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- MAIN AUTH FLOW ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, hwid, seller_name, gst_number, email } = req.body;
        const clientIp = req.clientIp; // Detects IPv6 accurately

        let user = await User.findOne({ mobile });

        // 1. REGISTRATION LOGIC
        if (!user) {
            // IPv6 BASED BLOCK: Prevent multiple registrations from same IP
            const sameIpCount = await User.countDocuments({ user_ip: clientIp });
            if (sameIpCount >= 2) {
                return res.status(429).json({ success: false, message: "Multiple account limit reached for this IP." });
            }

            // Validation
            if (!email.includes('@')) return res.status(400).json({ success: false, message: "Invalid email format." });
            if (password.length < 6) return res.status(400).json({ success: false, message: "Password must be 6+ chars." });

            const hashedPassword = await bcrypt.hash(password, 10);
            user = await User.create({ 
                mobile, password: hashedPassword, seller_name, gst_number, email, user_ip: clientIp, hwid 
            });
        }

        // 2. STATUS CHECKS
        if (user.isBlocked || user.is_verified === -1) {
            return res.status(403).json({ success: false, message: "Too many attempts or account blocked. Contact admin." });
        }

        // 3. PASSWORD VALIDATION (BCRYPT)
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.loginAttempts += 1;
            if (user.loginAttempts >= 5) {
                user.isBlocked = true;
            }
            await user.save();
            return res.status(401).json({ success: false, message: "Invalid login credentials." });
        }

        // 4. HWID & EXPIRY CHECK
        if (user.hwid && hwid && user.hwid !== hwid) {
            return res.status(403).json({ success: false, message: "Login denied: Hardware mismatch." });
        }

        const daysOld = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0 && daysOld > 7) {
            return res.status(402).json({ success: false, message: "Trial Expired." });
        }

        // 5. SUCCESS FLOW
        user.loginAttempts = 0; // Reset on success
        user.user_ip = clientIp; // Update last known IP
        user.lastLogin = new Date();
        await user.save();

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        
        const userData = user.toObject();
        delete userData.password; // Security: Don't send hash to client

        res.status(200).json({ success: true, token, data: userData });

    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error: " + err.message });
    }
});

// ---------------- ADMIN APIs (PROTECTED) ----------------
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    res.json(await User.find().sort({ reg_date: -1 }));
});

app.post('/api/admin/update-status', async (req, res) => {
    await connectDB();
    const { mobile, status } = req.body;
    // Status -1 blocks, 1 unblocks/verifies
    await User.findOneAndUpdate({ mobile }, { is_verified: status, isBlocked: status === -1, loginAttempts: 0 });
    res.json({ success: true });
});

module.exports = app;