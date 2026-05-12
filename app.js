const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();

// --- VERCEL STABILITY SETTINGS ---
app.set('trust proxy', 1); 

// --- CONFIGURATION ---
const ADMIN_IDS = [
    "895054825316839424", // Cox (Main)
    "698645469907124346", // Michael 
    "1101613108524499117", // Mudding 
    "1437923739227521044"  // ALT (COX)
];

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'fivem', 
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 5,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
});

// --- MIDDLEWARE ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'va5pd-secure-key-2026',
    resave: true, 
    saveUninitialized: false,
    proxy: true, 
    cookie: { secure: true, maxAge: 60000 * 60 * 24, sameSite: 'lax' }
}));

// --- PASSPORT AUTHENTICATION ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1405718321747197972', 
    clientSecret: process.env.DISCORD_CLIENT_SECRET, 
    callbackURL: 'https://va5pd2026.vercel.app/auth/discord/callback',
    scope: ['identify'] 
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

app.use(passport.initialize());
app.use(passport.session());

// --- SECURITY HELPER ---
const checkAdmin = (req) => {
    return req.isAuthenticated() && ADMIN_IDS.includes(req.user.id);
};

// --- PAGE ROUTES (THE FIX IS HERE) ---

app.get('/', (req, res) => {
    const isUserAdmin = checkAdmin(req);
    res.render('home', { 
        user: req.user, 
        isAdmin: isUserAdmin, 
        // If they are an admin, we pass their own ID as 'owner' to unlock buttons
        owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0] 
    });
});

app.get('/status', async (req, res) => {
    const JOIN_CODE = "9pvveb";
    let serverData = { online: false, players: [], maxPlayers: 64, name: "Virginia FivePD", joinUrl: `https://cfx.re/join/${JOIN_CODE}` };
    try {
        const response = await axios.get(`https://servers-frontend.fivem.net/api/servers/single/${JOIN_CODE}`, { timeout: 5000 });
        if (response.data?.Data) {
            serverData.online = true;
            serverData.players = response.data.Data.players || [];
            serverData.maxPlayers = response.data.Data.sv_maxclients || 64;
        }
    } catch (e) {}
    
    const isUserAdmin = checkAdmin(req);
    res.render('status', { 
        user: req.user, 
        server: serverData, 
        isAdmin: isUserAdmin,
        owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0]
    });
});

app.get('/store', (req, res) => {
    db.query("SELECT * FROM store_items ORDER BY is_announcement DESC, createdAt DESC", (err, results) => {
        const isUserAdmin = checkAdmin(req);
        res.render('store', { 
            user: req.user, 
            items: results || [], 
            isAdmin: isUserAdmin, 
            owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0],
            ticketUrl: "https://discord.gg/5xpZrjBNDq" 
        });
    });
});

app.get('/updates', (req, res) => {
    db.query("SELECT * FROM updates ORDER BY createdAt DESC", (err, results) => {
        const isUserAdmin = checkAdmin(req);
        res.render('updates', { 
            user: req.user, 
            updates: results || [], 
            isAdmin: isUserAdmin,
            owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0]
        });
    });
});

app.get('/admin', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized Access");
    try {
        const promiseDb = db.promise();
        const [updatesRes] = await promiseDb.query("SELECT COUNT(*) as count FROM updates");
        const [itemsRes] = await promiseDb.query("SELECT COUNT(*) as count FROM store_items");
        
        res.render('admin_panel', { 
            user: req.user, 
            isAdmin: true, 
            owner: req.user.id, // Unlock everything for the person viewing
            adminPanelData: { 
                stats: { updates: updatesRes[0].count, items: itemsRes[0].count, activeUsers: 0 }, 
                users: [] 
            } 
        });
    } catch (err) { res.status(500).send("Admin Error: " + err.message); }
});

// --- ADMIN ACTIONS ---
app.post('/updates/post', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    const { title, message, contributors, img1, img2, img3 } = req.body;
    await db.promise().query("INSERT INTO updates (title, message, contributors, img1, img2, img3) VALUES (?, ?, ?, ?, ?, ?)", [title, message, contributors, img1, img2, img3]);
    res.redirect('/updates');
});

app.get('/updates/delete/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    await db.promise().query("DELETE FROM updates WHERE id = ?", [req.params.id]);
    res.redirect('/updates');
});

app.post('/store/add', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    const ann = (is_announcement === '1' || is_announcement === 'on') ? 1 : 0;
    await db.promise().query("INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)", [title, description, price, sale_price || null, image || null, category, ann]);
    res.redirect('/store');
});

app.get('/store/delete/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    await db.promise().query("DELETE FROM store_items WHERE id = ?", [req.params.id]);
    res.redirect('/store');
});

// --- AUTH ---
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => console.log('Running on http://localhost:4000'));
}
module.exports = app;
