import express from 'express';

const app = express();
app.use(express.json({ limit: '20mb' }));

app.post('/ocr', async (req, res) => {
  console.info('[ocr-server] request received');
  res.json({ text: '', meta: { strategy: 'tesseract-stub' } });
});

app.listen(7070, () => {
  console.log('OCR server stub listening on :7070');
});
