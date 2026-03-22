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

module.exports = app;