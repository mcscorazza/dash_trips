require('dotenv').config();
const express = require('express');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { Pool } = require('pg');

const app = express();
app.use(express.static('public'));

const dbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION || 'sa-east-1' });
const dynamo = DynamoDBDocumentClient.from(dbClient);

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

app.get('/api/trips', async (req, res) => {
  try {
    const result = await dynamo.send(new ScanCommand({ TableName: 'trip_state_tracker' }));

    const trips = result.Items.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));

    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/map-data/:batch_id', async (req, res) => {
  try {
    const { batch_id } = req.params;

    const query = `
            SELECT geo_points 
            FROM trip_geolocations 
            WHERE batch_id = $1 
            ORDER BY start_timestamp ASC
        `;
    const { rows } = await pool.query(query, [batch_id]);

    let rotaCompleta = [];
    rows.forEach(row => {
      const pontosTrecho = row.geo_points.map(p => ({
        lat: p.lat,
        lng: p.lng,
        t: p.t
      }));
      rotaCompleta = rotaCompleta.concat(pontosTrecho);
    });

    res.json(rotaCompleta);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.error(error);
  }
});

app.get('/api/chart/:batch_id/:parquet_ref', async (req, res) => {
  const { batch_id, parquet_ref } = req.params;

  try {
    console.log(`Buscando dados do gráfico no RDS para: ${parquet_ref}`);

    const query = `
            SELECT chart_data 
            FROM trip_geolocations 
            WHERE batch_id = $1 AND parquet_ref = $2
        `;

    const result = await db.query(query, [batch_id, parquet_ref]);

    if (result.rows.length > 0) {
      const jsonData = result.rows[0].chart_data;

      console.log(`Sucesso! JSON retornado em tempo recorde.`);
      res.json(jsonData);
    } else {
      res.status(404).json({ error: "Trecho não encontrado no banco de dados." });
    }

  } catch (error) {
    console.error("Erro ao buscar no PostgreSQL:", error);
    res.status(500).json({ error: "Falha interna no servidor." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));