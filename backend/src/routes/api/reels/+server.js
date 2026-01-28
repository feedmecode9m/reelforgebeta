import { json } from '@sveltejs/kit';
import fs from 'fs';

const DB_PATH = 'src/data/reels.json';

export async function GET() {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return json(JSON.parse(data));
}

export async function POST({ request }) {
    const newReel = await request.json();
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    data.push(newReel);
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return json({ success: true });
}
