require('dotenv').config();
const express = require('express');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { Pool } = require('pg');

const app = express();
app.use(express.static('public'));

const dbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION || 'sa-east-1' });
const dynamo = DynamoDBDocumentClient.from(dbClient);

const db = new Pool({
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

// ==========================================
// ROTA DO MAPA: Traz as coordenadas e a criticidade
// ==========================================
app.get('/api/map/:batch_id', async (req, res) => {
  const { batch_id } = req.params;

  try {
    const query = `
            SELECT geo_points, is_critical, parquet_ref 
            FROM trip_geolocations 
            WHERE batch_id = $1 
            ORDER BY start_timestamp ASC
        `;

    const result = await db.query(query, [batch_id]);

    if (result.rows.length > 0) {
      res.json(result.rows);
    } else {
      res.status(404).json({ error: "Nenhuma coordenada encontrada para esta viagem." });
    }
  } catch (error) {
    console.error("Erro ao buscar coordenadas no RDS:", error);
    res.status(500).json({ error: "Falha interna no servidor." });
  }
});

// ==========================================
// ROTA DO GRÁFICO: Atualizada com a Média Global
// ==========================================
app.get('/api/chart/:batch_id/:parquet_ref', async (req, res) => {
  const { batch_id, parquet_ref } = req.params;

  try {
    console.log(`Buscando dados avançados no RDS para: ${parquet_ref}`);
    const queryChart = `
            SELECT chart_data 
            FROM trip_geolocations 
            WHERE batch_id = $1 AND parquet_ref = $2
        `;

    const queryAvg = `
            SELECT SUM(chunk_sum) / NULLIF(SUM(chunk_count), 0) AS global_avg
            FROM trip_geolocations
            WHERE batch_id = $1
        `;

    const [resultChart, resultAvg] = await Promise.all([
      db.query(queryChart, [batch_id, parquet_ref]),
      db.query(queryAvg, [batch_id])
    ]);

    if (resultChart.rows.length > 0) {
      const chartData = resultChart.rows[0].chart_data;
      const globalAvg = parseFloat(resultAvg.rows[0].global_avg || 0);

      res.json({
        points: chartData,
        global_average: globalAvg
      });
    } else {
      res.status(404).json({ error: "Trecho não encontrado." });
    }

  } catch (error) {
    console.error("Erro no Node.js:", error);
    res.status(500).json({ error: "Falha interna." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));