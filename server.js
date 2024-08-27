import express from 'express'; 
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt'; // Import bcrypt for password hashing
import pkg from 'pg';
import cors from "cors";
const { Client } = pkg;
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'; // Import passport-jwt

const app = express();
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true, // This allows cookies and other credentials to be included in requests
}));
// Database client setup
const db = new Client({
  user: 'postgres',      
  host: 'localhost',    
  database: 'Ecommerse', 
  password: 'Sonu@123', 
  port: 5432            
});

// Connect to the database
db.connect()
  .then(() => console.log('Connected to the database'))
  .catch(err => console.error('Connection error', err.stack));

// JWT strategy setup
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: 'your_jwt_secret', 
};

passport.use(new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE user_id=$1', [jwt_payload.id]);
    const user = result.rows[0];
    if (user) {
      return done(null, user);
    } else {
      return done(null, false);
    }
  } catch (err) {
    return done(err, false);
  }
}));

// Middleware setup
app.use(express.json()); // Middleware to parse JSON bodies
app.use(passport.initialize()); // Initialize Passport

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      const payload = { id: user.user_id };
      const token = jwt.sign(payload, 'your_jwt_secret', { expiresIn: '1h' });
      res.json({ token });
    } else {
      res.status(401).send('Invalid credentials');
    }
  } catch (err) {
    res.status(500).send('Error logging in');
  }
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *', [username, hashedPassword]);
    const newUser = result.rows[0];
    const payload = { id: newUser.user_id };
    const token = jwt.sign(payload, 'your_jwt_secret', { expiresIn: '1h' }); 
    res.status(201).json({ message: 'User registered successfully', token });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.get('/check-session', passport.authenticate('jwt', { session: false }), async (req, res) => {
res.sendStatus(200);
});
app.post('/checkOut', passport.authenticate('jwt', { session: false }), (req, res) => {
    // Your checkout logic here
    // This route will be protected and will only be accessible with a valid JWT token
    res.sendStatus(200);
});
app.post('/cart', passport.authenticate('jwt', { session: false }), async (req, res) => {
  const { item } = req.body;

  if (!item || !item.name || !item.price || !item.quantity) {
    return res.status(400).json({ message: 'Invalid item data' });
  }

  const userId = req.user.user_id;

  try {
    // Check if the item already exists in the cart
    const existingItem = await db.query(
      'SELECT * FROM cart WHERE user_id = $1 AND name = $2',
      [userId, item.name]
    );

    if (existingItem.rows.length > 0) {
      await db.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND name = $3',
        [item.quantity, userId, item.name]
      );
    } else {
      await db.query(
        'INSERT INTO cart (user_id, name, image, price, quantity) VALUES ($1, $2, $3, $4, $5)',
        [userId, item.name, item.image, item.price, item.quantity]
      );
    }

    res.status(200).json({ message: 'Item added to cart' });
  } catch (err) {
    console.error('Error inserting item into cart:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/getCart', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const userId = req.user.user_id; 
    const result = await db.query('SELECT * FROM cart WHERE user_id=$1', [userId]);
    console.log(result.rows);
    res.json(result.rows);
});

app.post('/cart/delete', passport.authenticate('jwt', { session: false }), async (req, res) => {
  const { name } = req.body;
  const userId = req.user.user_id;
console.log(name);
  try {
    await db.query('DELETE FROM cart WHERE user_id = $1 AND name = $2', [userId, name]);
    res.status(200).json({ message: 'Item deleted from cart' });
  } catch (err) {
    console.error('Error deleting item from cart:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Start server
app.listen(5000, () => {
  console.log('Server running on port 5000');
});
