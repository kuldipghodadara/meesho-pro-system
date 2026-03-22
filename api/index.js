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
    raw_password: { type: String }, // Optional: Only if you must see plain text in dashboard
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

// Direct route to serve the Admin Dashboard
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
                raw_password: password, // Store raw version for dashboard view
                user_ip: userIp, 
                hwid: hwid 
            });
            return res.json({ success: true, data: user });
        }

        // --- LOGIN LOGIC ---
        if (!user) return res.json({ success: false, message: "User not found" });

        // Verify password against hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.json({ success: false, message: "Incorrect password" });

        // Security: Block account if a different mobile tries using the same IP
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            user.is_verified = -1; 
            await user.save();
            return res.json({ success: false, message: "Security Alert: IP Conflict. Account Blocked." });
        }

        // Check if blocked by admin
        if (user.is_verified === -1) {
            return res.json({ success: false, message: "Account Blocked. Contact Support." });
        }

        // Update session details
        user.user_ip = userIp;
        if (!user.hwid) user.hwid = hwid;
        await user.save();

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------------- ADMIN API (DASHBOARD ACTIONS) ----------------

// Get all users (Includes raw_password for your dashboard view)
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find().sort({ reg_date: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// Update Status: 1 to Unblock/Activate, -1 to Block
app.post('/api/admin/update-status', async (req, res) => {
    try {
        await connectDB();
        const { mobile, status } = req.body; 
        const user = await User.findOneAndUpdate({ mobile }, { is_verified: status }, { new: true });
        if (user) res.json({ success: true, message: "Status updated" });
        else res.status(404).json({ success: false, message: "User not found" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete User
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        await connectDB();
        const { mobile } = req.body;
        const result = await User.findOneAndDelete({ mobile });
        if (result) res.json({ success: true, message: "User deleted" });
        else res.status(404).json({ success: false, message: "User not found" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update Subscription Details
app.post('/api/admin/update-subscription', async (req, res) => {
    try {
        await connectDB();
        const { mobile, plan, expiry_date } = req.body;
        const user = await User.findOneAndUpdate(
            { mobile },
            { plan, expiry_date, is_verified: 1 },
            { new: true }
        );
        if (user) res.json({ success: true, message: "Subscription updated" });
        else res.status(404).json({ success: false, message: "User not found" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;