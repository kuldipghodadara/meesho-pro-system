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


// --- NEW ROUTE: UPDATE USER PROFILE ---
app.post('/api/update-profile', async (req, res) => {
    try {
        await connectDB();
        const { mobile, seller_name, gst_number, email } = req.body;
        
        const updatedUser = await User.findOneAndUpdate(
            { mobile },
            { seller_name, gst_number, email },
            { new: true }
        );

        if (!updatedUser) return res.json({ success: false, message: "User not found" });
        res.json({ success: true, data: updatedUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


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

// --- ROUTE: APP VERIFICATION & HEARTBEAT ---
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, password, action } = req.body;
        
        let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        let userIp = rawIp.includes(',') ? rawIp.split(',')[0].trim() : rawIp;

        // 1. FIND THE USER
        let user = await User.findOne({ mobile });

        // 2. LOGOUT LOGIC
        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        // 3. LOGIN / HEARTBEAT LOGIC (THE FIX)
        if (action === 'login') {
            if (!user) {
                // If user was deleted from dashboard, return failure. DO NOT CREATE.
                return res.json({ success: false, message: "Account not found." });
            }
            if (password && user.password !== password) {
                return res.json({ success: false, message: "Invalid credentials." });
            }
            if (user.is_verified === -1) {
                return res.json({ success: false, message: "Account blocked." });
            }

            // User exists and is valid, just update status
            user.user_ip = userIp;
            user.is_online = true;
            await user.save();
            return res.json({ success: true, data: user });
        }

        // 4. REGISTRATION LOGIC
        if (action === 'register') {
            if (user) return res.json({ success: false, message: "User already exists. Please Login." });
            
            const newUser = new User({
                mobile,
                password,
                seller_name: req.body.seller_name,
                gst_number: req.body.gst_number,
                email: req.body.email,
                user_ip: userIp,
                is_online: true,
                plan: "Trial",
                is_verified: 0 // Waiting for admin approval
            });
            await newUser.save();
            return res.json({ success: true, data: newUser });
        }

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;