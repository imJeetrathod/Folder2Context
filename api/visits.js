export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://api.counterapi.dev/v1/folder2context/visits'
    );

    if (!response.ok) {
      throw new Error('CounterAPI failed');
    }

    const data = await response.json();

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch visit count' });
  }
}
