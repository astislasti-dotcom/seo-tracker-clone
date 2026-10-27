/**
 * Script para cargar los 31 keywords en Supabase
 * Ejecutar: node scripts/load-keywords.js
 */

const keywords = [
  {
    "keyword": "producción audiovisual para eventos",
    "intent": "Transaccional",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "empresa audiovisual para eventos",
    "intent": "Transaccional",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "audiovisuales para congresos",
    "intent": "Transaccional",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "producción audiovisual para congresos",
    "intent": "Transaccional",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "sistemas de proyección para eventos",
    "intent": "Comercial-mixta",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "iluminación para eventos profesionales",
    "intent": "Comercial-mixta",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "sonido para eventos",
    "intent": "Comercial-mixta",
    "priority": "P1",
    "domain": "3av.events"
  },
  {
    "keyword": "alquiler equipo audiovisual eventos",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "productora audiovisual madrid",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "videoconferencia profesional",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "streaming eventos en directo",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "retransmisión en vivo eventos",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "producción de eventos corporativos",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "3av.events"
  },
  {
    "keyword": "dirección de fotografía eventos",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "3av.events"
  },
  {
    "keyword": "edición de vídeo profesional",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "3av.events"
  },
  {
    "keyword": "plataforma de streaming especializada",
    "intent": "Informacional",
    "priority": "P3",
    "domain": "3av.events"
  },
  {
    "keyword": "transmisión de congresos online",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "hosting de eventos virtuales",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "plataforma eventos virtuales",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "webinar profesional en directo",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "soluciones audiovisuales integradas",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "consultoría eventos digitales",
    "intent": "Informacional",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "producción contenido multimedia",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "servicios audiovisuales profesionales",
    "intent": "Transaccional",
    "priority": "P1",
    "domain": "astisl.es"
  },
  {
    "keyword": "experiencias immersivas eventos",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "realidad aumentada para eventos",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "hologramas para presentaciones",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "videomapping profesional",
    "intent": "Comercial-mixta",
    "priority": "P3",
    "domain": "astisl.es"
  },
  {
    "keyword": "eventos corporativos producción",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "agencia de comunicación audiovisual",
    "intent": "Transaccional",
    "priority": "P2",
    "domain": "astisl.es"
  },
  {
    "keyword": "marketing experiencial audiovisual",
    "intent": "Comercial-mixta",
    "priority": "P2",
    "domain": "astisl.es"
  }
];

async function loadKeywords() {
  try {
    console.log('📊 Cargando 31 keywords en Supabase...');

    const response = await fetch('http://localhost:3000/api/keywords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(keywords),
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Keywords cargados exitosamente:', data.length || data);
    console.log('\n📈 Resumen:');
    console.log(`   - Total keywords: ${keywords.length}`);
    console.log(`   - Dominios: ${[...new Set(keywords.map(k => k.domain))].join(', ')}`);
    console.log(`   - P1: ${keywords.filter(k => k.priority === 'P1').length}`);
    console.log(`   - P2: ${keywords.filter(k => k.priority === 'P2').length}`);
    console.log(`   - P3: ${keywords.filter(k => k.priority === 'P3').length}`);
    console.log('\n🎉 ¡Dashboard listo para usar!');
  } catch (error) {
    console.error('❌ Error cargando keywords:', error.message);
    console.error('\n💡 Asegúrate de que:');
    console.error('   1. Tu servidor Next.js está corriendo (npm run dev)');
    console.error('   2. Las variables de entorno están en .env.local');
    console.error('   3. Supabase está accesible');
  }
}

loadKeywords();
