const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// MongoDB User Schema
const userSchema = new mongoose.Schema({
    mobile: { type: String, required: true },
    password: { type: String, required: true },
    seller_name: String,
    gst_number: String,
    email: String,
    user_ip: String,
    is_online: { type: Boolean, default: false },
    is_verified: { type: Number, default: 0 } // 0: Pending, 1: Approved, -1: Blocked
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

// Database Connection
const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    await mongoose.connect(process.env.MONGODB_URI);
};

app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, action } = req.body;

        // --- IP CLEANING LOGIC (Force IPv4) ---
        let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        let userIp = rawIp.includes(',') ? rawIp.split(',')[0].trim() : rawIp;
        
        // Strip IPv6 prefix (::ffff:) and handle localhost (::1)
        if (userIp.includes(':')) {
            userIp = userIp.split(':').pop();
        }
        if (userIp === '1') userIp = '127.0.0.1';

        const user = await User.findOne({ mobile });

        // --- LOGOUT ACTION ---
        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        // --- LOGIN / HEARTBEAT ACTION ---
        if (action === 'login') {
            if (!user) {
                // BUG FIX: If user deleted from DB, tell app to logout. DO NOT CREATE.
                return res.json({ success: false, message: "Account not found/Deleted." });
            }
            if (password && user.password !== password) {
                return res.json({ success: false, message: "Invalid password." });
            }
            if (user.is_verified === -1) {
                return res.json({ success: false, message: "Account blocked by admin." });
            }

            // Update status and IPv4
            user.user_ip = userIp;
            user.is_online = true;
            await user.save();
            
            // Return full user (including password for management panel)
            return res.json({ success: true, data: user });
        }

        // --- REGISTER ACTION ---
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "User already exists." });

            const newUser = new User({
                mobile,
                password, // Plain text as requested
                seller_name: req.body.seller_name,
                gst_number: req.body.gst_number,
                email: req.body.email,
                user_ip: userIp,
                is_online: true,
                is_verified: 0
            });
            await newUser.save();
            return res.json({ success: true, data: newUser });
        }

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;