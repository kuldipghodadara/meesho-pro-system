// const express = require('express');
// const mongoose = require('mongoose');
// const path = require('path');
// const cors = require('cors');
// const fs = require('fs');

// const app = express();
// app.use(cors());
// app.use(express.json());

// // ---------------- STATIC ----------------
// app.use('/public', express.static(path.join(process.cwd(), 'public')));

// // ---------------- DB CONNECTION ----------------
// let isConnected = false;

// async function connectDB() {
//     if (isConnected) return;

//     try {
//         if (!process.env.MONGODB_URI) {
//             throw new Error("❌ MONGODB_URI missing in environment variables");
//         }

//         const db = await mongoose.connect(process.env.MONGODB_URI, {
//             bufferCommands: false,
//             serverSelectionTimeoutMS: 5000
//         });

//         isConnected = db.connections[0].readyState;
//         console.log("✅ MongoDB Connected");
//     } catch (err) {
//         console.error("❌ MongoDB Error:", err.message);
//         throw err;
//     }
// }

// // ---------------- MODEL ----------------
// const UserSchema = new mongoose.Schema({
//     mobile: String,
//     seller_name: String,
//     gst_number: String,
//     email: String,
//     hwid: String,
//     is_verified: { type: Number, default: 1 }, // 1 = active, 0 = blocked
//     reg_date: { type: Date, default: Date.now }
// });

// const User = mongoose.models.User || mongoose.model('User', UserSchema);

// // ---------------- ROUTES ----------------

// // Health Check
// app.get('/', (req, res) => {
//     res.json({ message: "🚀 API Running Successfully" });
// });

// // Dashboard (FIXED for Vercel)
// app.get('/dashboard', (req, res) => {
//     try {
//         const filePath = path.join(process.cwd(), 'views', 'dashboard.html');
//         const html = fs.readFileSync(filePath, 'utf-8');
//         res.setHeader('Content-Type', 'text/html');
//         res.send(html);
//     } catch (err) {
//         res.status(500).send("Dashboard load error");
//     }
// });

// // ---------------- VERIFY / LOGIN ----------------
// app.post('/api/verify', async (req, res) => {
//     try {
//         await connectDB();

//         const { mobile, seller_name, gst_number, email, hwid } = req.body;

//         if (!mobile) {
//             return res.json({ success: false, message: "Mobile required" });
//         }

//         let user = await User.findOne({ mobile });

//         // Create user
//         if (!user) {
//             user = await User.create({
//                 mobile,
//                 seller_name,
//                 gst_number,
//                 email,
//                 hwid,
//                 is_verified: 1
//             });
//         } else {
//             // Update user
//             user.seller_name = seller_name;
//             user.gst_number = gst_number;
//             user.email = email;

//             // Lock device (optional)
//             if (!user.hwid) user.hwid = hwid;

//             await user.save();
//         }

//         // Block check
//         if (user.is_verified !== 1) {
//             return res.json({ success: false, message: "User Blocked" });
//         }

//         res.json({ success: true, data: user });

//     } catch (err) {
//         console.error("VERIFY ERROR:", err);
//         res.status(500).json({ success: false, message: err.message });
//     }
// });

// // ---------------- ADMIN APIs ----------------

// // Get all users
// app.get('/api/admin/users', async (req, res) => {
//     try {
//         await connectDB();

//         const users = await User.find().sort({ reg_date: -1 });

//         res.json(users);

//     } catch (err) {
//         console.error("GET USERS ERROR:", err);
//         res.status(500).json({ error: err.message });
//     }
// });

// // Block / Unblock user
// app.post('/api/admin/update-status', async (req, res) => {
//     try {
//         await connectDB();

//         const { mobile, status } = req.body;

//         await User.findOneAndUpdate(
//             { mobile },
//             { is_verified: status }
//         );

//         res.json({ success: true });

//     } catch (err) {
//         console.error("UPDATE STATUS ERROR:", err);
//         res.status(500).json({ success: false, error: err.message });
//     }
// });

// // ---------------- EXPORT FOR VERCEL ----------------
// module.exports = async (req, res) => {
//     try {
//         await connectDB();
//         return app(req, res);
//     } catch (err) {
//         res.status(500).json({ error: "Server Crash", detail: err.message });
//     }
// };

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- STATIC ----------------
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// ---------------- DB CONNECTION ----------------
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("❌ MONGODB_URI missing in environment variables");
        }
        const db = await mongoose.connect(process.env.MONGODB_URI, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000
        });
        isConnected = db.connections[0].readyState;
        console.log("✅ MongoDB Connected");
    } catch (err) {
        console.error("❌ MongoDB Error:", err.message);
        throw err;
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
    plan: { type: String, default: "Trial" }, // Stores months: "1", "2", "3", "6", "12"
    is_verified: { type: Number, default: 0 }, // 0 = Trial, 1 = Active, -1 = Blocked
    reg_date: { type: Date, default: Date.now },
    expiry_date: { type: Date, default: null } 
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- DASHBOARD ROUTE ----------------
app.get('/dashboard', (req, res) => {
    try {
        const filePath = path.join(process.cwd(), 'views', 'dashboard.html');
        if (fs.existsSync(filePath)) {
            const html = fs.readFileSync(filePath, 'utf-8');
            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        }
        res.status(404).send("Dashboard file not found");
    } catch (err) {
        res.status(500).send("Error loading dashboard");
    }
});

// ---------------- CLIENT API: VERIFY / LOGIN ----------------
app.post('/api/verify', async (req, res) => {
    try {
        await connectDB();
        const { mobile, seller_name, gst_number, email, hwid } = req.body;
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!mobile) return res.json({ success: false, message: "Mobile number required" });

        let user = await User.findOne({ mobile });

        // IP Conflict Security: Block if different mobile uses same IP (Anti-Fraud)
        const ipConflict = await User.findOne({ user_ip: userIp, mobile: { $ne: mobile } });
        if (ipConflict) {
            if (user) { user.is_verified = -1; await user.save(); }
            return res.json({ success: false, message: "Security Alert: Multiple accounts on one IP. Contact Support." });
        }

        if (!user) {
            // New Registration
            user = await User.create({
                mobile, seller_name, gst_number, email, hwid,
                user_ip: userIp, is_verified: 0 
            });
        } else {
            // Update existing user details
            user.user_ip = userIp;
            if (!user.hwid) user.hwid = hwid;
            await user.save();
        }

        // AUTO-BLOCK: Check if Expiry Date has passed
        if (user.expiry_date && new Date() > new Date(user.expiry_date)) {
            user.is_verified = -1;
            await user.save();
            return res.json({ success: false, message: "Subscription Expired. Please renew your plan." });
        }

        // Hard Block Check
        if (user.is_verified === -1) {
            return res.json({ success: false, message: "Account Blocked. Contact Administrator." });
        }

        // 7-Day Trial Logic (for users with is_verified = 0)
        const daysSinceReg = Math.floor((Date.now() - user.reg_date) / (1000 * 60 * 60 * 24));
        if (user.is_verified === 0) {
            if (daysSinceReg <= 7) {
                return res.json({ 
                    success: true, 
                    data: user, 
                    message: `Trial Active: ${7 - daysSinceReg} days remaining.` 
                });
            } else {
                return res.json({ success: false, message: "Free Trial Expired. Buy a plan to continue." });
            }
        }

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ---------------- ADMIN APIs ----------------

// 1. Get all users for table
app.get('/api/admin/users', async (req, res) => {
    try {
        await connectDB();
        const users = await User.find().sort({ reg_date: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Update Subscription (Plan & Expiry)
app.post('/api/admin/update-subscription', async (req, res) => {
    try {
        await connectDB();
        const { mobile, plan, expiry_date } = req.body;
        await User.findOneAndUpdate(
            { mobile }, 
            { plan, expiry_date, is_verified: 1 } // Auto-verify when plan is set
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 3. Simple Status Toggle (Verify/Block)
app.post('/api/admin/update-status', async (req, res) => {
    try {
        await connectDB();
        const { mobile, status } = req.body;
        await User.findOneAndUpdate({ mobile }, { is_verified: status });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 4. Delete User Permanently
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        await connectDB();
        const { mobile } = req.body;
        await User.findOneAndDelete({ mobile });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ---------------- VERCEL EXPORT ----------------
module.exports = async (req, res) => {
    await connectDB();
    return app(req, res);
};