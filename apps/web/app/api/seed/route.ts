import { NextResponse } from 'next/server';
import { seedDemo } from '@/scripts/seed-demo';

export async function POST() {
  try {
    await seedDemo();
    return NextResponse.json({ success: true, message: 'Demo data seeded successfully' });
  } catch (error) {
    console.error('Failed to seed demo data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to seed demo data' }, 
      { status: 500 }
    );
  }
}