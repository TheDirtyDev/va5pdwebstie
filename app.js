const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const app = express();

// --- CONFIGURATION ---
const OWNER_ID = "895054825316839424"; 
const GUILD_ID = "1447360424487030816"; 
const LEO_ROLE_ID = "1465133005977944237"; 

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'fivem', // Updated database name
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- SESSION & PASSPORT SETUP ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'va5pd-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true, 
    cookie: {
        secure: true, 
        maxAge: 60000 * 60 * 24,
        sameSite: 'lax'
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1461768848620654743', 
    clientSecret: process.env.DISCORD_CLIENT_SECRET, 
    callbackURL: 'https://va5pd2026.vercel.app/auth/discord/callback',
    scope: ['identify', 'guilds', 'guilds.members.read']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken; 
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// --- LEO PERMISSION CHECKER ---
async function getDiscordMember(user) {
    const token = user.accessToken;
    if (!token) return null;

    try {
        const response = await axios.get(
            `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        return response.data;
    } catch (error) {
        return null;
    }
}

// --- ROUTES ---

app.get('/', (req, res) => {
    res.render('home', { user: req.user, owner: OWNER_ID });
});

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// STORE PAGE
app.get('/store', (req, res) => {
    db.query("SELECT * FROM store_items ORDER BY is_announcement DESC, createdAt DESC", (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Database Error: " + err.message);
        }
        res.render('store', { 
            user: req.user, 
            items: results || [], 
            owner: OWNER_ID,
            ticketUrl: "https://discord.gg/5xpZrjBNDq" 
        });
    });
});

// ADMIN PANEL
app.get('/admin', async (req, res) => {
    // 1. Security Check
    if (!req.user || req.user.id !== OWNER_ID) {
        return res.status(403).send("Unauthorized Access");
    }

    try {
        // 2. Fetch Data using Promises for better stability on Vercel
        const promiseDb = db.promise();

        // Run all counts at once
        const [updateCount] = await promiseDb.query("SELECT COUNT(*) as count FROM updates");
        const [itemCount] = await promiseDb.query("SELECT COUNT(*) as count FROM store_items");
        
        // Use a try/catch specifically for reports in case the table is missing
        let recentReports = [];
        let pendingCount = 0;
        
        try {
            const [reports] = await promiseDb.query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 5");
            const [pending] = await promiseDb.query("SELECT COUNT(*) as count FROM reports WHERE status = 'Pending'");
            recentReports = reports;
            pendingCount = pending[0].count;
        } catch (reportErr) {
            console.log("Note: Reports table might be missing, skipping report stats.");
        }

        // 3. Render the full-screen Admin Dashboard
        res.render('admin_panel', {
            user: req.user,
            owner: OWNER_ID,
            adminPanelData: {
                stats: {
                    updates: updateCount[0].count,
                    items: itemCount[0].count,
                    activeUsers: 0, 
                    pendingReports: pendingCount
                },
                users: [], 
                recentReports: recentReports
            }
        });

    } catch (err) {
        console.error("Admin Route Error:", err);
        res.status(500).send(`
            <div style="background:#111; color:#ff4444; padding:20px; font-family:monospace;">
                <h1>Admin Panel Error</h1>
                <p>${err.message}</p>
                <a href="/" style="color:#fff;">Back Home</a>
            </div>
        `);
    }
});

// LEO DASHBOARD
app.get('/leo', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');
    const member = await getDiscordMember(req.user);
    
    if (member && member.roles.includes(LEO_ROLE_ID)) {
        res.render('leo', { user: req.user, member, owner: OWNER_ID });
    } else {
        res.status(403).send("Access Denied: LEO Role Required");
    }
});

// UPDATES PAGE
app.get('/updates', (req, res) => {
    db.query("SELECT * FROM updates ORDER BY createdAt DESC", (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.render('updates', { user: req.user, updates: results, owner: OWNER_ID });
    });
});

// --- UPDATES LOGIC ---

app.post('/updates/post', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, message, contributors, img1, img2, img3 } = req.body;
    const query = "INSERT INTO updates (title, message, contributors, img1, img2, img3) VALUES (?, ?, ?, ?, ?, ?)";
    
    try {
        await db.promise().query(query, [title, message, contributors, img1, img2, img3]);
        res.redirect('/updates');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error posting update: " + err.message);
    }
});

app.get('/updates/delete/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    try {
        await db.promise().query("DELETE FROM updates WHERE id = ?", [req.params.id]);
        res.redirect('/updates');
    } catch (err) {
        res.status(500).send("Error deleting update.");
    }
});

// --- STORE LOGIC ---

app.post('/store/add', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    // Checkboxes only send a value if checked; we convert it to 1 or 0 for MySQL
    const announcement = (is_announcement === '1' || is_announcement === 'on') ? 1 : 0;
    
    const query = "INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)";
    
    try {
        await db.promise().query(query, [
            title, 
            description, 
            price, 
            sale_price || null, 
            image || null, 
            category, 
            announcement
        ]);
        res.redirect('/store');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding product.");
    }
});

app.post('/store/edit/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, description, price, sale_price, image, category } = req.body;
    const query = "UPDATE store_items SET title=?, description=?, price=?, sale_price=?, image=?, category=? WHERE id=?";
    
    try {
        await db.promise().query(query, [
            title, 
            description, 
            price, 
            sale_price || null, 
            image || null, 
            category, 
            req.params.id
        ]);
        res.redirect('/store');
    } catch (err) {
        res.status(500).send("Error editing product.");
    }
});

app.get('/store/delete/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    try {
        await db.promise().query("DELETE FROM store_items WHERE id = ?", [req.params.id]);
        res.redirect('/store');
    } catch (err) {
        res.status(500).send("Error deleting product.");
    }
});
// --- ADMIN LOGIC ---
app.post('/store/add', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    const announcement = is_announcement ? 1 : 0;
    db.query("INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)", 
    [title, description, price, sale_price || null, image, category, announcement], (err) => {
        if (err) return res.status(500).send(err.message);
        res.redirect('/store');
    });
});

app.get('/store/delete/:id', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    db.query("DELETE FROM store_items WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err.message);
        res.redirect('/store');
    });
});

// --- VERCEL EXPORT ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => console.log('Running on http://localhost:4000'));
}

module.exports = app;
