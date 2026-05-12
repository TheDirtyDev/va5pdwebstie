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
    "1437923739227521044"  // ALT 
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

// --- PAGE ROUTES ---

app.get('/', (req, res) => {
    const isUserAdmin = checkAdmin(req);
    res.render('home', { 
        user: req.user, 
        isAdmin: isUserAdmin, 
        owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0] 
    });
});

app.get('/status', async (req, res) => {
    const JOIN_CODE = "9pvveb";
    let serverData = { online: false, players: [], maxPlayers: 64, name: "Virginia Roleplay | Active Staff/LEO | Apply now for a department", joinUrl: `https://cfx.re/join/${JOIN_CODE}` };
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
            owner: req.user.id, 
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

// EMAIL
app.post('/tools/email-receipt', async (req, res) => {
    const { email, handler, card, taxRate, signature, items, subtotal, taxAmount, grandTotal } = req.body;

    // Configuration for Gmail
    let transporter = nodemailer.createTransport({
        service: 'gmail',
       auth: { 
            user: process.env.EMAIL_USER, 
            pass: process.env.EMAIL_PASS 
        }
    });

    // Build the table rows for the HTML email
    const itemRows = items.map(item => `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-family: sans-serif; font-size: 14px;">${item.desc}</td>
            <td style="padding: 10px; font-family: sans-serif; font-size: 14px; text-align: right; font-weight: bold;">$${item.price}</td>
        </tr>
    `).join('');

    const htmlBody = `
    <div style="background-color: #f8fafc; padding: 40px; font-family: sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
            <div style="background-color: #0b0f1a; padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">VA5PD NETWORK</h1>
                <p style="color: #64748b; margin: 5px 0 0; font-size: 12px; text-transform: uppercase;">Transaction Receipt</p>
            </div>
            <div style="padding: 30px;">
                <table width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td style="font-size: 12px; color: #64748b;"><strong>BILLED TO:</strong><br>${email}</td>
                        <td style="font-size: 12px; color: #64748b; text-align: right;"><strong>DATE:</strong><br>${new Date().toLocaleDateString()}</td>
                    </tr>
                </table>
                
                <table width="100%" style="border-collapse: collapse; margin-bottom: 20px;">
                    <thead>
                        <tr style="background-color: #f1f5f9;">
                            <th style="text-align: left; padding: 10px; font-size: 12px;">Item Description</th>
                            <th style="text-align: right; padding: 10px; font-size: 12px;">Price</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                </table>

                <div style="text-align: right; border-top: 2px solid #f1f5f9; padding-top: 15px;">
                    <p style="margin: 5px 0; font-size: 14px;">Subtotal: <strong>$${subtotal}</strong></p>
                    <p style="margin: 5px 0; font-size: 14px;">Tax (${taxRate}%): <strong>$${taxAmount}</strong></p>
                    <p style="margin: 10px 0; font-size: 20px; color: #ef4444;"><strong>Total: $${grandTotal}</strong></p>
                </div>

                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed #e2e8f0;">
                    <p style="font-size: 10px; color: #94a3b8; margin-bottom: 5px;">AUTHORIZED HANDLER: ${handler}</p>
                    <p style="font-size: 10px; color: #94a3b8; margin-bottom: 5px;">PAYMENT METHOD: ${card}</p>
                    <p style="font-family: 'Georgia', serif; font-size: 24px; color: #ef4444; margin: 10px 0;">${signature}</p>
                </div>
            </div>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8;">
                Thank you for choosing VA5PD. This is an automated receipt.
            </div>
        </div>
    </div>`;

    try {
        await transporter.sendMail({
            from: '"VA5PD Network" <virginia5pd.support@gmail.com>',
            to: email,
            subject: 'Your Official VA5PD Receipt',
            html: htmlBody // Send HTML here
        });
        res.status(200).send('OK');
    } catch (err) {
        console.error("Nodemailer Error:", err.message);
        res.status(500).send(err.message);
    }
});

// --- AUTH ---
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => console.log('Running on http://localhost:4000'));
}
module.exports = app;
