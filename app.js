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
app.get('/admin', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");

    const queries = [
        "SELECT COUNT(*) as count FROM updates",
        "SELECT COUNT(*) as count FROM store_items",
        "SELECT * FROM reports ORDER BY created_at DESC LIMIT 5",
        "SELECT COUNT(*) as count FROM reports WHERE status = 'Pending'"
    ].join('; ');

    db.query(queries, (err, results) => {
        if (err) return res.status(500).send("Database Error");
        res.render('admin_panel', {
            user: req.user,
            owner: OWNER_ID,
            adminPanelData: {
                stats: {
                    updates: results[0][0].count,
                    items: results[1][0].count,
                    activeUsers: 0, 
                    pendingReports: results[3][0].count
                },
                users: [], 
                recentReports: results[2]
            }
        });
    });
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
