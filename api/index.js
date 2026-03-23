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
    is_verified: { type: Number, default: 0 }, // 0: Pending, 1: Approved, -1: Blocked
    reg_date: { type: Date, default: Date.now } // Added to track registration timing
    plan: { type: String, default: 'Trial' }, 
    expiry_date: { type: Date }
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

        let user = await User.findOne({ mobile });

        if (action === 'logout') {
            if (user) { user.is_online = false; await user.save(); }
            return res.json({ success: true });
        }

        if (action === 'login') {
            if (!user) return res.json({ success: false, message: "Account not found." });
            if (password && user.password !== password) return res.json({ success: false, message: "Invalid credentials." });
            if (user.is_verified === -1) return res.json({ success: false, message: "Account blocked." });

            user.user_ip = userIp;
            user.is_online = true;
            await user.save();
            return res.json({ success: true, data: user });
        }

        if (action === 'register') {
            // Logic check only for existing mobile number
            if (user) return res.json({ success: false, message: "User already exists. Please Login." });
            
            const newUser = new User({
                mobile,
                password,
                seller_name: req.body.seller_name,
                gst_number: req.body.gst_number,
                email: req.body.email,
                user_ip: userIp, // Store IP for conflict management
                is_online: true,
                plan: "Trial",
                is_verified: 0 
            });
            await newUser.save();
            return res.json({ success: true, data: newUser });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- NEW ROUTE: BLOCK ALL CONFLICTS FOR AN IP ---
app.post('/api/admin/block-conflicts', async (req, res) => {
    try {
        await connectDB();
        const { ip } = req.body;
        
        // Find all users with this IP, sorted by registration date
        const users = await User.find({ user_ip: ip }).sort({ reg_date: 1 });

        if (users.length <= 1) {
            return res.json({ success: true, message: "No conflicts to block." });
        }

        // Extract mobiles of all users except the first one (the original)
        const conflictMobiles = users.slice(1).map(u => u.mobile);

        // Update all conflict accounts to status -1 (Blocked)
        await User.updateMany(
            { mobile: { $in: conflictMobiles } },
            { is_verified: -1 }
        );

        res.json({ success: true, blockedCount: conflictMobiles.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;