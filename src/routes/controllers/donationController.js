// src/routes/controllers/donationController.js
const supabase = require('../../config/supabaseClient');

// Adjust this to your real currency -> liters conversion logic.
// Example: $1 funds 12 liters of clean water.
const LITERS_PER_CURRENCY_UNIT = 12;
const PEOPLE_REACHED_PER_DONATION = 4; // rough estimate per successful donation
const WELL_FUNDING_THRESHOLD = 500; // amount (in your currency) that counts as "funded a well"

/**
 * POST /api/donations
 * Call this AFTER your payment provider confirms the charge succeeded
 * (e.g. from a Stripe webhook handler, or from your frontend immediately
 * after the payment SDK returns success — webhook is the safer option
 * since it can't be spoofed by the client).
 *
 * Body: { paymentId, provider, amount, currency, donorEmail?, donorName? }
 */
const createDonation = async (req, res) => {
  try {
    const { paymentId, provider, amount, currency, donorEmail, donorName } = req.body;

    if (!paymentId || !amount) {
      return res.status(400).json({ error: 'paymentId and amount are required' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const liters = Number((numericAmount * LITERS_PER_CURRENCY_UNIT).toFixed(2));
    const wellFunded = numericAmount >= WELL_FUNDING_THRESHOLD;

    // Idempotency: payment_id is UNIQUE in the table, so re-sending the same
    // webhook event (which providers do) won't double-count the donation.
    const { data, error } = await supabase
      .from('donations')
      .insert({
        payment_id: paymentId,
        provider: provider || 'unknown',
        amount: numericAmount,
        currency: currency || 'USD',
        liters,
        people_reached: PEOPLE_REACHED_PER_DONATION,
        well_funded: wellFunded,
        donor_email: donorEmail || null,
        donor_name: donorName || null,
        status: 'succeeded',
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation -> this payment was already recorded, treat as success
      if (error.code === '23505') {
        return res.status(200).json({ message: 'Donation already recorded' });
      }
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to record donation' });
    }

    return res.status(201).json({ donation: data });
  } catch (err) {
    console.error('createDonation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/donations/stats
 * Public, read-only aggregate numbers for the homepage widget.
 * Backed by the `donation_stats` SQL view (see migration file) so no
 * individual donor data is ever exposed.
 */
const getDonationStats = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('donation_stats')
      .select('*')
      .single();

    if (error) {
      console.error('Supabase stats error:', error);
      return res.status(500).json({ error: 'Failed to fetch donation stats' });
    }

    return res.status(200).json({
      litersThisMonth: Number(data.liters_this_month) || 0,
      peopleReached: Number(data.people_reached_total) || 0,
      wellsFunded: Number(data.wells_funded_total) || 0,
    });
  } catch (err) {
    console.error('getDonationStats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { createDonation, getDonationStats };