import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Expected file upload' }, { status: 400 });
  }
  console.info('[api/pdf/extract] received file', file.name, file.size);
  return NextResponse.json({ text: '', meta: { name: file.name, size: file.size } });
}
