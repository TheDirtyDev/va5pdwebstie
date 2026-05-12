const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// --- VERCEL STABILITY SETTINGS ---
app.set('trust proxy', 1);

// --- CONFIGURATION ---
const ADMIN_IDS = [
    "895054825316839424", // Cox (Main)
    "698645469907124346", // Michael 
    "1101613108524499117" // Mudding 
];

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root', // Standard local default
    password: process.env.DB_PASSWORD || '', // Standard local default
    database: process.env.DB_NAME || 'fivem',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    // Turn off SSL for local development to avoid the previous error
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
});
// --- MIDDLEWARE ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- SESSION FIX ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'va5pd-secure-key-2026',
    resave: false, // Changed to false for better session stability
    saveUninitialized: false,
    proxy: true,
    cookie: {
        // FIX: secure must be false for http://localhost
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60000 * 60 * 24,
        sameSite: 'lax'
    }
}));

// --- PASSPORT AUTHENTICATION ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1405718321747197972',
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    // Ensure this matches your Discord Developer Portal exactly
    callbackURL: process.env.NODE_ENV === 'production'
        ? 'https://va5pd2026.vercel.app/auth/discord/callback'
        : 'http://localhost:3000/auth/discord/callback',
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
    let serverData = { online: false, players: [], maxPlayers: 64, name: "Virginia FivePD", joinUrl: `https://cfx.re/join/${JOIN_CODE}` };
    try {
        const response = await axios.get(`https://servers-frontend.fivem.net/api/servers/single/${JOIN_CODE}`, { timeout: 5000 });
        if (response.data?.Data) {
            serverData.online = true;
            serverData.players = response.data.Data.players || [];
            serverData.maxPlayers = response.data.Data.sv_maxclients || 64;
        }
    } catch (e) { }

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

// STRIPE 
app.post('/create-checkout-session', async (req, res) => {
    const { itemId } = req.body;
    
    try {
        // Use .promise() so await actually works
        const [items] = await db.promise().query('SELECT * FROM store_items WHERE id = ?', [itemId]);
        const item = items[0];

        if (!item) {
            return res.status(404).json({ error: "Item not found" });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: item.title,
                        description: item.description,
                        images: item.image ? [item.image] : [],
                    },
                    // Use sale_price if it exists, otherwise normal price
                    unit_amount: Math.round((item.sale_price || item.price) * 100), 
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin}/store`,
        });

        res.json({ id: session.id });
    } catch (err) {
        console.error("Stripe Error:", err.message);
        res.status(500).json({ error: err.message });
    }
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

app.post('/store/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { title, category, price, sale_price, image, description } = req.body;

    try {
        // If using MongoDB/Mongoose:
        // await YourModelName.findByIdAndUpdate(id, { title, category, price, sale_price, image, description });

        // If using SQL:
        await db.promise().query('UPDATE store_items SET title=?, category=?, price=?, sale_price=?, image=?, description=? WHERE id=?', [title, category, price, sale_price || null, image || null, description, id]);

        res.redirect('/store');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Update Failed");
    }
});

// --- RECRUIT ONBOARDING ROUTE ---
app.get('/onboard/:token', async (req, res) => {
    const onboardToken = req.params.token;

    // 1. You could check your database here to see if the token is valid
    // 2. For now, let's just render the onboarding page

    try {
        // We pass the user and admin status so the navbar stays consistent
        const isUserAdmin = checkAdmin(req);

        res.render('onboard', {
            token: onboardToken,
            user: req.user,
            isAdmin: isUserAdmin,
            owner: (isUserAdmin && req.user) ? req.user.id : ADMIN_IDS[0]
        });
    } catch (err) {
        console.error("Onboarding Error:", err.message);
        res.status(500).send("Error loading onboarding page.");
    }
});

app.post('/onboard/submit', async (req, res) => {
    const {
        token, discordId, firstName, lastName, age,
        stack, specialization, signature
    } = req.body;

    try {
        // 1. Save to Database
        const [result] = await db.promise().query(
            "INSERT INTO recruits (discord_id, first_name, last_name, age, stack, specialization, signature, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [discordId, firstName, lastName, age, stack, specialization, signature, token]
        );

        // 2. Generate the unique Review ID (using the database row ID)
        const reviewId = result.insertId;
        const reviewLink = `http://localhost:3000/onboard/review/${reviewId}`;

        // 3. Send Success Response with the instructions
        res.send(`
            <body style="background:#060910; color:#e2e8f0; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; padding:20px;">
                <div style="background:#0f172a; padding:40px; border-radius:15px; border:1px solid #1e293b; max-width:500px; width:100%; text-align:center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                    <div style="color:#22c55e; font-size:50px; margin-bottom:20px;"><i class="fas fa-check-circle"></i></div>
                    <h1 style="color:white; margin-bottom:10px;">SUBMISSION COMPLETE</h1>
                    <p style="color:#94a3b8; line-height:1.6;">Your application has been successfully logged to the database.</p>
                    
                    <div style="margin:30px 0; background:#020617; padding:20px; border-radius:10px; border:1px dashed #334155;">
                        <p style="color:#ef4444; font-size:12px; font-weight:bold; text-transform:uppercase; margin-bottom:10px; letter-spacing:1px;">Review Link Generated</p>
                        <input type="text" value="${reviewLink}" readonly style="width:100%; background:#1e293b; border:none; color:#3b82f6; padding:10px; border-radius:5px; text-align:center; font-family:monospace; margin-bottom:10px;">
                        <p style="color:#64748b; font-size:13px;">Please send this link to your ticket so we can review.</p>
                    </div>

                    <p style="color:#ef4444; font-size:11px; font-style:italic;">
                        Secure Link. Please only share with yourself and trusted administrative team as it contains your information!
                    </p>
                    
                    <a href="/" style="display:inline-block; margin-top:20px; color:#94a3b8; text-decoration:none; font-size:14px;">Return to Dashboard</a>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
            </body>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error: " + err.message);
    }
});

app.get('/onboard/review/:id', async (req, res) => {
    const reviewId = req.params.id;

    try {
        // Fetch the specific recruit data from XAMPP
        const [rows] = await db.promise().query("SELECT * FROM recruits WHERE id = ?", [reviewId]);
        
        if (rows.length === 0) {
            return res.status(404).send("Application not found.");
        }

        const recruitData = rows[0];

        if (!checkAdmin(req)) {
            return res.status(403).send("Unauthorized: Only Ownership can review records.");
        }

        res.render('review', { 
            recruit: recruitData,
            user: req.user,
            isAdmin: true
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading review page.");
    }
});

app.post('/api/delete-recruit/:id', async (req, res) => {
    const recruitId = req.params.id;
    // Ensure only authorized users can delete
    if (req.user.id !== '895054825316839424') return res.status(403).send('Unauthorized');

    const query = "DELETE FROM recruits WHERE id = ?";
    db.query(query, [recruitId], (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// Success / Termination Page
app.get('/session-terminated', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Session Deleted</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                body { background: #020617; color: white; font-family: 'Inter', sans-serif; }
                .glow { box-shadow: 0 0 50px rgba(220, 38, 38, 0.1); }
            </style>
        </head>
        <body class="min-h-screen flex items-center justify-center p-6">
            <div class="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-2xl text-center glow">
                <div class="text-red-500 text-6xl mb-6">
                    <i class="fas fa-circle-check"></i>
                </div>
                <h1 class="text-2xl font-black uppercase tracking-tighter mb-2">Record Purged</h1>
                <p class="text-slate-400 text-sm mb-8">The recruitment dossier has been successfully removed from the database and all local session data has been cleared.</p>
                
                <div class="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                    <i class="fas fa-spinner animate-spin"></i>
                    <span>Redirecting to Home...</span>
                </div>
            </div>

            <script>
                // Redirect to home after 4 seconds
                setTimeout(() => {
                    window.location.href = "/"; 
                }, 4000);
            </script>
        </body>
        </html>
    `);
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

// --- AUTH CALLBACK FIX ---
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    // If the user is a Lead Dev/Admin, take them straight to the panel
    if (checkAdmin(req)) {
        return res.redirect('/admin');
    }
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        res.redirect('/');
    });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('🚀 Running on http://localhost:3000'));
}
module.exports = app;
