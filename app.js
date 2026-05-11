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
// Using createPool instead of createConnection is much better for Vercel's serverless nature
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'fivem_reports',
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

// Vercel Path Fixes
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

// --- PAGE ROUTES ---

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

// ... Keep your other routes (leo, admin, etc.) here ...

// --- VERCEL EXPORT ---
// IMPORTANT: Vercel needs the app exported, not just listening
if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => {
        console.log('Web running on http://localhost:4000');
    });
}

module.exports = app;
