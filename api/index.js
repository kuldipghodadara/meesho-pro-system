const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
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

// --- ROUTE: SERVE DASHBOARD HTML ---
app.get('/dashboard', (req, res) => {
    // Serves the file from your /views directory
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// --- ROUTE: ADMIN API TO FETCH ALL USERS ---
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find({});
        res.json(users); // Sends full user data including passwords
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTE: APP VERIFICATION & HEARTBEAT ---
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, action } = req.body;

        // Clean IP Logic: Convert IPv6/Localhost to clean IPv4
        let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        let userIp = rawIp.includes(',') ? rawIp.split(',')[0].trim() : rawIp;
        if (userIp.includes(':')) {
            userIp = userIp.split(':').pop();
        }
        if (userIp === '1') userIp = '127.0.0.1';

        const user = await User.findOne({ mobile });

        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        if (action === 'login') {
            if (!user) {
                return res.json({ success: false, message: "Account not found/Deleted." });
            }
            if (password && user.password !== password) {
                return res.json({ success: false, message: "Invalid password." });
            }
            if (user.is_verified === -1) {
                return res.json({ success: false, message: "Account blocked by admin." });
            }

            user.user_ip = userIp;
            user.is_online = true;
            await user.save();
            return res.json({ success: true, data: user });
        }

        if (action === 'register') {
            if (user) return res.json({ success: false, message: "User already exists." });

            const newUser = new User({
                mobile,
                password, 
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