import express from 'express'; 
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt'; // Import bcrypt for password hashing
import pkg from 'pg';
import cors from "cors";
const { Client } = pkg;
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'; // Import passport-jwt
import axios from "axios";
import dotenv from 'dotenv';
 dotenv.config();
const app = express();
app.use(cors({
  origin: process.env.BASEURL ,
  credentials: true, // This allows cookies and other credentials to be included in requests
}));

// Middleware to parse JSON bodies
app.use(express.json()); 

// (Optional) Middleware to parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));
// Database client setup
const db = new Client({
  connectionString: process.env.CONNECTIONSTRING
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

app.post(
  '/checkOut',
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    const cartItems = req.body.cartItems; // [{ id, quantity, price }, ...]

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty or invalid' });
    }


    try {

      // 1️⃣ Calculate total
      const total = cartItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // 2️⃣ Insert one order
      const orderResult = await db.query(
        `INSERT INTO orders (user_id, total, status)
         VALUES ($1, $2, $3)
         RETURNING order_id`,
        [req.user.user_id, total, 'Processing']
      );

      const orderId = orderResult.rows[0].order_id;

      // 3️⃣ Insert each item into order_items
      for (const item of cartItems) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, item.id, item.quantity, item.price]
        );
      }

      // 4️⃣ Clear the user's cart
      await db.query(`DELETE FROM cart WHERE user_id = $1`, [
        req.user.user_id
      ]);

      res.status(200).json({
        message: 'Order placed successfully',
        orderId
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error inserting orders:', err);
      res.status(500).json({ error: 'Failed to place order' });
    } 
  }
);


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
    res.json(result.rows);
});

app.post('/cart/delete', passport.authenticate('jwt', { session: false }), async (req, res) => {
  const { name } = req.body;
  const userId = req.user.user_id;
  try {
    await db.query('DELETE FROM cart WHERE user_id = $1 AND name = $2', [userId, name]);
    res.status(200).json({ message: 'Item deleted from cart' });
  } catch (err) {
    console.error('Error deleting item from cart:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.get('/products', (req, res) => {
  const sql = 'SELECT * FROM products ORDER BY RANDOM() LIMIT 20;';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching products:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results.rows);
  });
});

app.get('/products/category/:category', async (req, res) => {
  const { category } = req.params; // <-- from URL path
  try {
    const result = await db.query(
      'SELECT * FROM products WHERE category = $1',
      [category]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching category products:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});



app.get('/categories', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT category FROM products ORDER BY category ASC`
    );

    // Extract category names into an array
    const categories = result.rows.map(row => row.category);

    res.json(categories);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get(
  '/orders',
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      // Fetch all orders for the logged-in user
      const ordersResult = await db.query(
        `SELECT * 
         FROM orders
         WHERE user_id = $1
         ORDER BY date_placed DESC`,
        [req.user.user_id]
      );

      const orders = ordersResult.rows;

      if (orders.length === 0) {
        return res.json([]);
      }

      // Fetch all order items for these orders
      const orderIds = orders.map(o => o.order_id);

      const itemsResult = await db.query(
        `SELECT oi.*, p.title, p.image
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ANY($1::int[])`,
        [orderIds]
      );

      const items = itemsResult.rows;

      // Group items by order_id
      const groupedOrders = orders.map(order => {
        return {
          ...order,
          items: items.filter(i => i.order_id === order.order_id)
        };
      });

      res.json(groupedOrders);
    } catch (err) {
      console.error('Error fetching orders:', err);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  }
);

app.get(
  "/orders/:id",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get the order
      const orderRes = await db.query(
        `SELECT * FROM orders
         WHERE order_id = $1 AND user_id = $2`,
        [id, req.user.user_id]
      );

      if (orderRes.rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orderRes.rows[0];

      // Get all items for the order
      const itemsRes = await db.query(
        `SELECT oi.*, p.title, p.image
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [id]
      );

      order.items = itemsRes.rows;

      res.json(order);
    } catch (err) {
      console.error("Error fetching order:", err);
      res.status(500).json({ error: "Failed to fetch order" });
    }
  }
);



// Start server
app.listen(5000, () => {
  console.log('Server running on port 5000');
});
