const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

// ---------------- USER MODEL ----------------
const UserSchema = new mongoose.Schema({
    mobile: String,
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

// ---------------- CLIENT API: VERIFY ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, hwid, public_ip } = req.body;

        // 1. Normalize IP (Handle IPv6 mapping)
        let cleanIp = public_ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (cleanIp && cleanIp.includes('::ffff:')) cleanIp = cleanIp.split('::ffff:')[1];

        let user = await User.findOne({ mobile });

        // 2. Network Conflict Check (One network per active account)
        const conflict = await User.findOne({ 
            user_ip: cleanIp, 
            mobile: { $ne: mobile }, 
            is_verified: { $ne: -1 } 
        });
        if (conflict) return res.json({ success: false, message: "Security Alert: Network already linked to another account." });

        // 3. HWID Lock & Registration
        if (!user) {
            user = await User.create({ ...req.body, user_ip: cleanIp, is_verified: 0 });
        } else {
            if (user.hwid && user.hwid !== hwid) {
                return res.json({ success: false, message: "Hardware mismatch. Access denied." });
            }
            user.user_ip = cleanIp;
            user.hwid = hwid;
            await user.save();
        }

        // 4. Status Checks
        if (user.is_verified === -1) return res.json({ success: false, message: "Account Blocked." });
        
        const daysOld = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0 && daysOld > 7) return res.json({ success: false, message: "7-Day Trial Expired." });

        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            return res.json({ success: false, message: "Subscription Expired." });
        }

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;