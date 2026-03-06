require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.static('public'));

const dynamo = new AWS.DynamoDB.DocumentClient({ region: 'sa-east-1' });

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

// Rota 1: Retorna a lista de viagens do DynamoDB
app.get('/api/trips', async (req, res) => {
  try {
    // Para o teste, um Scan resolve bem. Em prod, usaríamos um Query no GSI.
    const result = await dynamo.scan({ TableName: 'trips' }).promise();
    res.json(result.Items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota 2: Retorna os pontos do Aurora unindo todos os trechos daquela viagem
app.get('/api/map-data/:batch_id', async (req, res) => {
  try {
    const { batch_id } = req.params;
    // Busca todos os trechos da viagem ordenados cronologicamente
    const query = `
            SELECT geo_points 
            FROM trip_geolocations 
            WHERE batch_id = $1 
            ORDER BY start_timestamp ASC
        `;
    const { rows } = await pool.query(query, [batch_id]);

    // Junta os vetores de todos os trechos numa única lista contínua
    let rotaCompleta = [];
    rows.forEach(row => {
      // O Leaflet espera um array [latitude, longitude]
      const pontosTrecho = row.geo_points.map(p => [p.lat, p.lng]);
      rotaCompleta = rotaCompleta.concat(pontosTrecho);
    });

    res.json(rotaCompleta);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.error(error);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));