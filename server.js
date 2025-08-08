import express from 'express'; 
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt'; // Import bcrypt for password hashing
import pkg from 'pg';
import cors from "cors";
import db from './db/db.js';
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

async function unsetDefaultForUser(userId) {
  await db.query(
    'UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND deleted_at IS NULL',
    [userId]
  );
}
// GET /getAddresses
app.get('/getAddresses', async (req, res) => {
  const user_id = 6;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  try {
    const query = `
      SELECT *
      FROM user_addresses
      WHERE user_id = $1
        AND deleted_at IS NULL
      ORDER BY is_default DESC, updated_at DESC;
    `;
    const { rows } = await db.query(query, [user_id]);

    // Convert DB snake_case → frontend camelCase
    const formatted = rows.map(row => ({
      id: row.id,
      fullName: row.full_name,
      addressLine1: row.line1,
      addressLine2: row.line2,
      city: row.city,
      state: row.state,
      zip: row.postal_code,
      mobile: row.phone,
      isDefault: row.is_default
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});



// POST /addAddress
// POST /addAddress
app.post('/addAddress', async (req, res) => {
  console.log(req.body);

  // Destructure using frontend field names
  const {
    fullName,
    addressLine1,
    addressLine2,
    city,
    state,
    zip,
    mobile,
    isDefault
  } = req.body.newAddress;

  const user_id = 6; // Replace with actual logged-in user ID

  // Validate required fields
  if (!user_id || !fullName || !addressLine1 || !city || !zip) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    if (isDefault) {
      await unsetDefaultForUser(user_id);
    }

    const insertQuery = `
      INSERT INTO user_addresses
        (user_id, full_name, phone, line1, line2, city, state, postal_code, is_default)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *;
    `;

    const { rows } = await db.query(insertQuery, [
      user_id,
      fullName,
      mobile || null,
      addressLine1,
      addressLine2 || null,
      city,
      state || null,
      zip,
      isDefault || false
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add address' });
  }
});

// POST /updateAddress
app.post('/updateAddress', async (req, res) => {
  let { id, user_id, ...fields } = req.body.address || req.body; // support if frontend sends { address: {...} }
  user_id=6;
  if (!id || !user_id) {
    return res.status(400).json({ error: 'Missing id or user_id' });
  }

  // Map frontend camelCase → DB snake_case
  const fieldMap = {
    fullName: 'full_name',
    addressLine1: 'line1',
    addressLine2: 'line2',
    city: 'city',
    state: 'state',
    zip: 'postal_code',
    mobile: 'phone',
    isDefault: 'is_default'
  };

  const dbFields = {};
  for (const key in fields) {
    if (fieldMap[key]) {
      dbFields[fieldMap[key]] = fields[key];
    }
  }

  try {
    // If setting as default, unset existing default
    if (dbFields.is_default) {
      await unsetDefaultForUser(user_id);
    }

    const keys = Object.keys(dbFields);
    if (!keys.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const setClauses = keys.map((key, i) => `${key} = $${i + 1}`);
    const values = keys.map(k => dbFields[k]);
    values.push(id, user_id); // for WHERE clause

    const updateQuery = `
      UPDATE user_addresses
      SET ${setClauses.join(', ')}, updated_at = now()
      WHERE id = $${keys.length + 1}
        AND user_id = $${keys.length + 2}
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await db.query(updateQuery, values);

    if (!rows.length) {
      return res.status(404).json({ error: 'Address not found' });
    }

    // Convert DB snake_case → frontend camelCase for response
    const row = rows[0];
    const formatted = {
      id: row.id,
      fullName: row.full_name,
      addressLine1: row.line1,
      addressLine2: row.line2,
      city: row.city,
      state: row.state,
      zip: row.postal_code,
      mobile: row.phone,
      isDefault: row.is_default
    };

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update address' });
  }
});


app.post(
  '/checkOut',
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    
    const cartItems = req.body.cartItems; // [{ id, quantity, price }, ...]
    const address = req.body.address;     // Full address object from frontend
    const paymentMethod = req.body.paymentMethod;     
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty or invalid' });
    }

    if (!address || !address.id) {
      return res.status(400).json({ error: 'Address is required' });
    }
    try {
      // 1️⃣ Check if the address already exists for this user
      const adress = await db.query(
        `SELECT id FROM user_addresses 
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [address.id, req.user.user_id]
      );
      
      // 2️⃣ If not found, insert the provided address into user_addresses
      if (adress.rows.length === 0) {
         adress=await db.query(
          `INSERT INTO user_addresses
            ( user_id, label, full_name, phone, line1, line2, city, state, postal_code, is_default)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            req.user.user_id,
            address.label || null,
            address.fullName,
            address.mobile || null,
            address.addressLine1,
            address.addressLine2 || null,
            address.city,
            address.state,
            address.zip,
            address.isDefault || false
          ]
        );
      }
      const addressId = adress.rows[0].id;

      // 3️⃣ Calculate total
      const total = cartItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
      console.log(addressId);
      // 4️⃣ Insert order (reference the address_id)
      const orderResult = await db.query(
        `INSERT INTO orders (user_id, total, status, address,payment_method)
         VALUES ($1, $2, $3, $4,$5)
         RETURNING order_id`,
        [req.user.user_id, total, 'Processing', addressId,paymentMethod]
      );

      const orderId = orderResult.rows[0].order_id;

      // 5️⃣ Insert each item into order_items
      for (const item of cartItems) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, item.id, item.quantity, item.price]
        );
      }

      // 6️⃣ Clear the user's cart
      await db.query(`DELETE FROM cart WHERE user_id = $1`, [
        req.user.user_id
      ]);

      res.status(200).json({
        message: 'Order placed successfully',
        orderId
      });
    } catch (err) {
      console.error('Error inserting orders:', err);
      res.status(500).json({ error: 'Failed to place order' });
    }
  }
);


// POST /deleteAddress
app.post('/deleteAddress', async (req, res) => {
  const { id } = req.body;
  const user_id=6;
  if (!id || !user_id) {
    return res.status(400).json({ error: 'Missing id or user_id' });
  }

  try {
    const deleteQuery = `
      UPDATE user_addresses
      SET deleted_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await db.query(deleteQuery, [id, user_id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Address not found or already deleted' });
    }

    res.json({ success: true, message: 'Address deleted successfully', deletedAddress: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});


app.post('/cart', passport.authenticate('jwt', { session: false }), async (req, res) => {
  const { item } = req.body;

  if (!item || !item.name || !item.price || !item.quantity || !item.id) {
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
        "INSERT INTO cart (user_id, name, image, price, quantity,product_id) VALUES ($1, $2, $3, $4, $5,$6)",
        [userId, item.name, item.image, item.price, item.quantity, item.id]
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
    const result = await db.query('SELECT name, image, user_id, price, quantity,  id AS product_id FROM cart WHERE user_id = $1', [userId]);
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
  console.log(category);
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
app.patch('/orders/:id/cancel',  passport.authenticate('jwt', { session: false }), async (req, res) => {
  const orderId = req.params.id;

  try {
    const query = `
      UPDATE orders
      SET status = 'Cancelled'
      WHERE order_id = $1
      RETURNING *;
    `;

    const result = await db.query(query, [orderId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json({ message: 'Order cancelled', order: result.rows[0] });
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.get(
  "/orders/:id",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      const { id,address_id } = req.params;

      // Get the order
      const orderRes = await db.query(
        `SELECT * FROM orders
         WHERE order_id = $1 AND user_id = $2`,
        [id, req.user.user_id]
      );
      const shipping_address = await db.query(
        `SELECT * FROM user_addresses
         WHERE id= $1`,
        [orderRes.rows[0].address]
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
      res.json({
        order: order,                          // your order object
        shipping_address: shipping_address.rows[0] // your address from DB
      });
    } catch (err) {
      console.error("Error fetching order:", err);
      res.status(500).json({ error: "Failed to fetch order" });
    }
  }
);

app.get('/highlights', async (req, res) => {
  try {
    const bestDealsQuery = `
  SELECT * FROM products
  WHERE discount IS NOT NULL
  ORDER BY discount DESC
  LIMIT 5
`;

    const phonesQuery = `
      SELECT * FROM products 
      WHERE category ILIKE '%mobile%' 
      ORDER BY discount DESC 
      LIMIT 5
    `;

    const laptopsQuery = `
      SELECT * FROM products 
      WHERE category ILIKE '%laptop%' 
      ORDER BY discount DESC
      LIMIT 5
    `;

    const mensClothingQuery = `
      SELECT * FROM products 
      WHERE category ILIKE '%men''s clothing%' 
      LIMIT 1
    `;

    const womensClothingQuery = `
      SELECT * FROM products 
      WHERE category ILIKE '%women''s clothing%' 
      LIMIT 1
    `;

    const jewelryQuery = `
      SELECT * FROM products 
      WHERE category ILIKE '%jewel%' 
      LIMIT 1
    `;

    const [bestDeals,phones, laptops, mens, womens, jewelry] = await Promise.all([
      db.query(bestDealsQuery),
      db.query(phonesQuery),
      db.query(laptopsQuery),
      db.query(mensClothingQuery),
      db.query(womensClothingQuery),
      db.query(jewelryQuery)
    ]);

    res.json({
      bestDeals:bestDeals.rows,
      phones: phones.rows,
      laptops: laptops.rows,
      categories: {
        mensClothing: mens.rows[0] || null,
        womensClothing: womens.rows[0] || null,
        jewelry: jewelry.rows[0] || null
      }
    });
  } catch (error) {
    console.error('Error fetching highlights:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


// Start server
app.listen(5000, () => {
  console.log('Server running on port 5000');
});
