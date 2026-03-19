require('dotenv').config();
const express = require('express');
const parquet = require('parquetjs-lite');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static('public'));

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION || 'sa-east-1' });
const BUCKET_NAME = process.env.BUCKET_NAME || 'trips-raw-data';

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

// ==========================================
// ROTA DE DOWNSAMPLING DO PARQUET
// ==========================================
app.get('/api/chart/:batch_id/:parquet_ref', async (req, res) => {
  const { batch_id, parquet_ref } = req.params;

  const s3Key = `consolidated/batch_id=${batch_id}/${parquet_ref}`;
  const localFilePath = path.join('/tmp', parquet_ref);

  try {
    console.log(`Baixando Parquet do S3: ${s3Key}...`);
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3.send(command);

    const fileStream = fs.createWriteStream(localFilePath);
    response.Body.pipe(fileStream);

    await new Promise((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    let reader = await parquet.ParquetReader.openFile(localFilePath);
    let cursor = reader.getCursor();
    let record = null;

    const chartData = [];
    let primeiraLinha = true;

    while (record = await cursor.next()) {

      if (primeiraLinha) {
        console.log("\n🔍 ESTRUTURA REAL DO PARQUET NO NODE.JS:");
        console.dir(record, { depth: null, colors: true });
        primeiraLinha = false;
      }

      if (record.sensors && Array.isArray(record.sensors) && record.sensors.length > 0) {
        const primeiroSensor = record.sensors[0];
        const leiturasBrutas = primeiroSensor.value;
        const timestamp = primeiroSensor.timestamp;
        if (leiturasBrutas && Array.isArray(leiturasBrutas) && leiturasBrutas.length > 0) {
          const picoMaximo = Math.max(...leiturasBrutas);
          const picoMinimo = Math.min(...leiturasBrutas);
          const soma = leiturasBrutas.reduce((a, b) => a + b, 0);
          const media = soma / leiturasBrutas.length;

          chartData.push({
            t: timestamp,
            max_strain: picoMaximo,
            min_strain: picoMinimo,
            avg_strain: parseFloat(media.toFixed(2))
          });
        }
      }
    }
    await reader.close();
    fs.unlinkSync(localFilePath);
    console.log(`Sucesso! 120.000 pontos reduzidos para ${chartData.length} pontos.`);
    res.json(chartData);

  } catch (error) {
    console.error("Erro ao processar o Parquet:", error);

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    res.status(500).json({ error: "Falha ao processar os dados de telemetria." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));