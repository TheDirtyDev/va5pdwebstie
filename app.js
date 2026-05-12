const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();

// --- CONFIGURATION ---
const OWNER_ROLE_ID = "1449514984290783433"; 
const OWNER_ID = "895054825316839424"; 
const GUILD_ID = "1447360424487030816"; 

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'fivem', 
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
});

// --- MIDDLEWARE ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'va5pd-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true, 
    cookie: { secure: true, maxAge: 60000 * 60 * 24, sameSite: 'lax' }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// --- UPDATED DISCORD STRATEGY ---
passport.use(new DiscordStrategy({
    clientID: '1447464281540005888', 
    clientSecret: process.env.DISCORD_CLIENT_SECRET, 
    callbackURL: 'https://va5pd2026.vercel.app/auth/discord/callback',
    scope: ['identify', 'guilds'] // Simplified scopes
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Fetch the user's specific roles in your GUILD using your Bot Token
        const response = await axios.get(
            `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${profile.id}`,
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        // Attach the roles directly to the profile object
        profile.roles = response.data.roles || [];
    } catch (err) {
        console.error("Discord Role Fetch Error:", err.message);
        profile.roles = []; // Default to no roles if they aren't in the server
    }
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// --- SECURITY HELPER ---
const checkAdmin = (req) => {
    if (!req.user) return false;
    const hasRole = req.user.roles && req.user.roles.includes(OWNER_ROLE_ID);
    const isOwner = req.user.id === OWNER_ID;
    return hasRole || isOwner;
};
// --- AUTH ROUTES ---
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// --- PAGE ROUTES ---

app.get('/', (req, res) => {
    res.render('home', { user: req.user, isAdmin: checkAdmin(req), owner: OWNER_ID });
});

app.get('/status', async (req, res) => {
    const JOIN_CODE = "9pvveb";
    const HARDCODED_NAME = "Virginia FivePD | Active Staff/LEO | Apply now for a department!";
    let serverData = { online: false, players: [], maxPlayers: 64, name: HARDCODED_NAME, joinUrl: `https://cfx.re/join/${JOIN_CODE}` };

    try {
        const response = await axios.get(`https://servers-frontend.fivem.net/api/servers/single/${JOIN_CODE}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000 
        });
        if (response.data && response.data.Data) {
            serverData.online = true;
            serverData.players = response.data.Data.players || [];
            serverData.maxPlayers = response.data.Data.sv_maxclients || 64;
        }
    } catch (error) { console.error("FiveM API Error:", error.message); }

    res.render('status', { user: req.user, server: serverData, isAdmin: checkAdmin(req) });
});

app.get('/store', (req, res) => {
    db.query("SELECT * FROM store_items ORDER BY is_announcement DESC, createdAt DESC", (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.render('store', { user: req.user, items: results || [], isAdmin: checkAdmin(req), owner: OWNER_ID, ticketUrl: "https://discord.gg/5xpZrjBNDq" });
    });
});

app.get('/updates', (req, res) => {
    db.query("SELECT * FROM updates ORDER BY createdAt DESC", (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.render('updates', { user: req.user, updates: results, isAdmin: checkAdmin(req), owner: OWNER_ID });
    });
});

// --- ADMIN PANEL ---
app.get('/admin', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    try {
        const promiseDb = db.promise();
        // Fixed destructuring to correctly handle promise pool results
        const [updatesRes] = await promiseDb.query("SELECT COUNT(*) as count FROM updates");
        const [itemsRes] = await promiseDb.query("SELECT COUNT(*) as count FROM store_items");
        
        res.render('admin_panel', { 
            user: req.user, 
            isAdmin: true, 
            adminPanelData: { 
                stats: { 
                    updates: updatesRes[0].count, 
                    items: itemsRes[0].count, 
                    activeUsers: 0 
                }, 
                users: [] 
            } 
        });
    } catch (err) { 
        res.status(500).send(err.message); 
    }
});

// --- POSTING & TOOLS ---

app.post('/updates/post', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    const { title, message, contributors, img1, img2, img3 } = req.body;
    try {
        await db.promise().query("INSERT INTO updates (title, message, contributors, img1, img2, img3) VALUES (?, ?, ?, ?, ?, ?)", [title, message, contributors, img1, img2, img3]);
        res.redirect('/updates');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/updates/delete/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    try {
        await db.promise().query("DELETE FROM updates WHERE id = ?", [req.params.id]);
        res.redirect('/updates');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/store/add', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    const ann = (is_announcement === '1' || is_announcement === 'on') ? 1 : 0;
    try {
        await db.promise().query("INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)", [title, description, price, sale_price || null, image || null, category, ann]);
        res.redirect('/store');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/store/delete/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).send("Unauthorized");
    try {
        await db.promise().query("DELETE FROM store_items WHERE id = ?", [req.params.id]);
        res.redirect('/store');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/tools/email-receipt', async (req, res) => {
    const { email, handler, card, taxRate, signature, items, grandTotal } = req.body;
    if (!email || !items) return res.status(400).send("Missing data.");
    
    let transporter = nodemailer.createTransport({ 
        host: 'smtp.gmail.com', 
        port: 465, 
        secure: true, 
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } 
    });

    const itemRows = items.map(i => `<tr><td>${i.desc}</td><td>$${i.price}</td></tr>`).join('');
    
    try {
        await transporter.sendMail({ 
            from: `"VA5PD Network" <${process.env.EMAIL_USER}>`, 
            to: email, 
            subject: 'Official VA5PD Receipt', 
            html: `<h2>Receipt</h2><table>${itemRows}</table><p>Total: ${grandTotal}</p>` 
        });
        res.status(200).send('OK');
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- VERCEL EXPORT ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => console.log('Running on http://localhost:4000'));
}
module.exports = app;
