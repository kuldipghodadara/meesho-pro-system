const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from "public"
app.use(express.static(path.join(__dirname, '../public')));

// --- DATABASE CONNECTION CACHING ---
let isConnected = false;

const connectDB = async () => {
    if (isConnected) return;
    try {
        // Use the connection string from Vercel Environment Variables
        const db = await mongoose.connect(process.env.MONGODB_URI);
        isConnected = db.connections[0].readyState;
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
    }
};

// --- USER MODEL ---
const UserSchema = new mongoose.Schema({
    mobile: String,
    seller_name: String,
    is_verified: { type: Number, default: 0 },
    reg_date: { type: Date, default: Date.now }
});

// Avoid "OverwriteModelError" in serverless environments
const User = mongoose.models.User || mongoose.model('User', UserSchema);

// --- ADMIN ROUTES ---

// 1. Serve the Dashboard HTML
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// 2. API to get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB(); 
        const users = await User.find().sort({ reg_date: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. API to Verify/Block a user
app.post('/api/admin/update-status', async (req, res) => {
    try {
        await connectDB(); 
        const { mobile, status } = req.body;
        await User.findOneAndUpdate({ mobile }, { is_verified: status });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Root Health Check
app.get('/', (req, res) => res.send("Management API is Live"));

module.exports = app;