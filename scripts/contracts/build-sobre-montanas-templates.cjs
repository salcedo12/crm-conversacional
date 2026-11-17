/**
 * Construye las plantillas de Sobre Montañas (preventa + promesa común y proindiviso)
 * clonando las bases 2026 para conservar encabezados, estilos, tablas y cajas de firma.
 *
 * Uso: node scripts/contracts/build-sobre-montanas-templates.cjs
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('../../functions/node_modules/pizzip');
const {
  bodyElements,
  setCellText,
  setParagraphAt,
  paragraphsWithText,
  replaceText,
  replaceRegion,
  textOf,
  elements,
} = require('./docxXml.cjs');

const TEMPLATES_DIR = path.resolve(__dirname, '../../functions/templates');

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeRun(text, { bold = false, underline = false } = {}) {
  const props = [];
  if (bold) props.push('<w:b w:val="1"/><w:bCs w:val="1"/>');
  if (underline) props.push('<w:u w:val="single"/>');
  props.push('<w:rtl w:val="0"/>');
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}

/** Construye un párrafo con estilo del cuerpo del contrato (soporta segmentos en negrita/subrayado). */
function makePara(segments, { numId = null, firstLine = 600, after = 120 } = {}) {
  const pPr = numId
    ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:ind w:left="426" w:hanging="360"/><w:rPr/></w:pPr>`
    : `<w:pPr><w:spacing w:after="${after}" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/><w:ind w:left="-5" w:firstLine="${firstLine}"/><w:rPr/></w:pPr>`;
  const runs = (typeof segments === 'string' ? [{ text: segments }] : segments)
    .map((s) => makeRun(s.text, s))
    .join('');
  return `<w:p>${pPr}${runs}</w:p>`;
}

function emptyPara(after = 80) {
  return `<w:p><w:pPr><w:spacing w:after="${after}" w:lineRule="auto"/><w:rPr/></w:pPr></w:p>`;
}

/** Clona el <w:p> de ejemplo cambiando su texto para preservar el formato exacto de lista/párrafo. */
function cloneStyledPara(sampleFrag, text) {
  const pOpen = sampleFrag.match(/^<w:p(?: [^>]*)?>/)[0].replace('/>', '>');
  const pPr = (sampleFrag.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const firstRun = sampleFrag.match(/<w:r(?=[ >])[\s\S]*?<\/w:r>/);
  const rPr = firstRun ? (firstRun[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0] : '';
  return `${pOpen}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

function checkWellFormed(xml, label) {
  const opens = (xml.match(/<w:p(?=[ >])/g) || []).length;
  const closes = (xml.match(/<\/w:p>/g) || []).length;
  const selfs = (xml.match(/<w:p\b[^>]*\/>/g) || []).length;
  if (opens - selfs !== closes) {
    throw new Error(`${label}: desbalance <w:p>: opens=${opens} self=${selfs} closes=${closes}`);
  }
  const tags = elements(xml, 'w:tbl');
  if (!tags.length) throw new Error(`${label}: sin tablas`);
}

function checkNoForbiddenText(xml, label) {
  const plain = textOf(xml);
  const forbidden = [
    'BATMAN',
    'PEPITO',
    'JUANA MARÍA',
    'Mar Santorini',
    'ALDEA 17',
    'CANARIAS',
    'SAN FRANCISCO',
    '901110049-1',
    '30,000 metros',
    '30.000 m2',
    '1.258 m2',
    '1027293230',
    '41,958,600',
    '43.500.000',
    '145.000.000',
    '1579.990.000',
    'CÓDIGO DE REFERENCIA DEL LOTE',
  ];
  for (const term of forbidden) {
    if (plain.includes(term)) {
      throw new Error(`${label}: contiene dato quemado residual "${term}"`);
    }
  }
  // Verificar balance de etiquetas docxtemplater
  const opens = (plain.match(/\{#/g) || []).length + (plain.match(/\{\^/g) || []).length;
  const closes = (plain.match(/\{\//g) || []).length;
  if (opens !== closes) {
    throw new Error(`${label}: llaves de bloque desbalanceadas (#/^=${opens}, /=${closes})`);
  }
}

// ---------------------------------------------------------------------------
// 1. PREVENTA SOBRE MONTAÑAS
// ---------------------------------------------------------------------------

function buildPreventaSobreMontanas() {
  const zip = new PizZip(fs.readFileSync(path.join(TEMPLATES_DIR, 'preventa-2026.docx')));
  let xml = zip.file('word/document.xml').asText();

  // Tabla S.I.M. T3: TIPO DE PROCESO (T0=compradores, T1=lote, T2=diligenciamiento, T3=datos negocio)
  xml = setCellText(xml, 3, 1, 1, 'COMPRAVENTA DE BIEN INMUEBLE COMÚN Y PROINDIVISO');

  // Encabezado S.I.M. y numeral 1
  xml = replaceText(xml, 'proceso de compraventa de bien inmueble sobre planos,', 'proceso de compraventa de bien inmueble común y proindiviso,');
  xml = replaceText(xml, 'al proceso de compraventa de bien inmueble sobre planos promovido', 'al proceso de compraventa de bien inmueble común y proindiviso promovido');

  // Numerales 4..18 del S.I.M.: tomamos el estilo exacto del numeral 4 existente ([34]) y reemplazamos [34..50]
  const els = bodyElements(xml);
  const numSample = xml.slice(els[34].start, els[34].end);
  const simItems = [
    '4.Que he(mos) recibido información detallada sobre la ubicación geográfica del proyecto, las condiciones topográficas del terreno que es totalmente elevado e inclinado en lomas, así como sobre las restricciones propias del desarrollo campestre conforme a las normas urbanísticas del municipio donde se localiza el proyecto y que no se garantizan los servicios públicos ya que EL PROMITENTE COMPRADOR debe implementar pozo séptico, energía solar y acueducto veredal.',
    '5.Que se me(nos) informó sobre la disponibilidad real de los predios ofrecidos, su extensión, ubicación y características, y que la selección del inmueble objeto del negocio fue realizada por mí(nosotros) de manera autónoma, informada, libre y consciente, identificándose el predio como: TERRENO No. {lote.numero} – ETAPA/SECTOR {lote.sector} {proyecto.nombre} ubicado en el municipio de {proyecto.municipio}, Tolima en zona rural a 10 minutos por vía terciaria en la finca denominada NAPOLES.',
    '6.Que con anterioridad a la suscripción del negocio jurídico recibí(mos) información completa sobre limitaciones y condiciones impuestas por la autoridad municipal, incluyendo lo relativo a la edificabilidad máxima permitida, aceptando expresamente que, dada la naturaleza campestre del proyecto, el área máxima de construcción siempre será inferior al cien por ciento (100%) del área total del inmueble conforme a las normas urbanísticas del municipio de {proyecto.municipio} vigentes al trámite de la licencia de construcción de la vivienda que no son del resorte de {vendedor.razonSocial}.',
    '7.Que se me(nos) explicó de forma previa y clara el objeto, alcance y efectos de todos los documentos utilizados en las etapas precontractual y contractual, incluyendo derechos y obligaciones derivados de los mismos, en estricto cumplimiento de la Circular Externa 004 de 2024 y del Estatuto del Consumidor.',
    '8.Que he(mos) conocido, analizado y comprendido previamente el texto íntegro del Contrato de Compraventa de Participación en Derecho de Dominio sobre Predio Rural, sobre el cual tuve(mos) la posibilidad real de formular observaciones, interrogantes y propuestas de modificación, reconociendo que el texto final fue construido de manera consensuada.',
    '9.Que en cumplimiento de lo dispuesto por el numeral 2.16.1 de la Circular Externa 004 de 2024, el contrato se regirá por las condiciones de precio, beneficios y forma de pago vigentes a la fecha de su suscripción, declarando que el precio consignado corresponde al precio mínimo inicial de venta y que todos los valores han sido expresados en moneda legal colombiana.',
    '10.Que reconozco(cemos) mi(nuestro) derecho a ser informado(s) oportunamente, a través de los canales aceptados, de cualquier modificación relevante que se presente durante el desarrollo de la relación contractual.',
    '11.Que he(mos) sido informado(s) de los planes promocionales o bonos otorgados, aceptando que los mismos se encuentran sujetos al cumplimiento estricto de las condiciones pactadas y que serán descontados o abonados al final y antes de expedir el paz y salvo respectivo y que no serán oponibles acuerdos verbales o compromisos no incorporados expresamente en los documentos contractuales.',
    '12.Que conozco(cemos) y acepto(amos) que el incumplimiento en los pagos genera mora automática, intereses moratorios a la tasa máxima legal permitida y la aplicación de las cláusulas contractuales de resolución y arras pactadas.',
    '13.Que el presente documento se suscribe de manera electrónica y/o digital, de conformidad con la Ley 527 de 1999, el Decreto 2364 de 2012 y las normas concordantes, haciendo parte integral, inseparable y vinculante de la totalidad de los instrumentos que conforman el proceso de compraventa de bien inmueble común y proindiviso, produciendo plenos efectos jurídicos y probatorios.',
    '14.Así mismo, se deja constancia expresa de que esta declaración se firma electrónicamente en la misma fecha de suscripción de los demás documentos que integran el proceso de compraventa de bien inmueble común y proindiviso, al cual se halla integrada e inseparable incluyendo, sin limitarse a ellos, los contratos de preventa, promesa de compraventa, compraventa, autorizaciones, anexos y demás documentos soporte.',
    '15. El único canal autorizado por la compañía para atender, resolver y dar respuesta a quejas, reclamos, solicitudes, aclaraciones o cualquier inquietud relacionada con la firma del presente contrato de preventa, la forma de pago, acuerdos de pago, especificaciones técnicas del objeto contractual o cualquier otro asunto derivado de la relación contractual, es la dependencia de SERVICIO AL CLIENTE, mediante comunicación electrónica o mediante la radicación escrita de la solicitud en la oficina principal de la compañía. En consecuencia, EL PROMITENTE VENDEDOR aclara que ninguna otra dependencia de la compañía y/o asesor comercial, o persona distinta al área autorizada de Servicio al Cliente se encuentra facultada para emitir respuestas, brindar información, realizar aclaraciones, asumir compromisos o resolver inquietudes en nombre de la compañía.',
    '16. EL PROMITENTE VENDEDOR le manifiesta AL(LOS) PROMITENTE(S) COMPRADOR(ES) que los pagos o cancelaciones de su obligación adquirida mediante el presente contrato de preventa, que realice en cuentas bancarias a terceras personas, a asesores comerciales o mediante envío de link de pagos digitales o mediante supuestas comunicaciones de estímulos por pagos tempranos, o por cualquier otro medio electrónico engañoso que desde ya hace claridad EL PROMITENTE VENDEDOR que no los autoriza, dichos pagos realizados de esta manera no serán tenidos en cuenta a las cancelaciones de las obligaciones de este contrato ya que los únicos medios de cancelación serán los acordados por las partes taxativamente en la CLÁUSULA TERCERA del Contrato de Compraventa de Participación en Derecho de Dominio sobre Predio Rural.',
  ];
  xml = replaceRegion(
    xml,
    (t) => t.startsWith('4.Que he(mos) recibido información detallada sobre la ubicación geográfica'),
    (t) => t.startsWith('18. EL PROMITENTE VENDEDOR le manifiesta'),
    simItems.map((txt) => cloneStyledPara(numSample, txt)).join(''),
  );

  // Título y cláusulas del Contrato de Preventa
  xml = replaceText(xml, 'CONTRATO DE PREVENTA DE BIEN INMUEBLE SOBRE PLANOS', 'CONTRATO DE PREVENTA DE BIEN INMUEBLE COMÚN Y PROINDIVISO');
  xml = replaceText(
    xml,
    'preventa vinculante de un bien inmueble sobre planos, identificado individualmente dentro del proyecto inmobiliario',
    'preventa vinculante de un BIEN INMUEBLE COMÚN Y PROINDIVISO, dentro del proyecto inmobiliario',
  );
  xml = replaceText(
    xml,
    'Las PARTES reconocen expresamente que el inmueble objeto de este contrato se encuentra en etapa de diseño, planeación o construcción, razón por la cual sus características finales podrán estar sujetas a ajustes técnicos no esenciales, derivados de replanteos constructivos, exigencias urbanísticas o normas técnicas aplicables, sin que ello altere la esencia económica del negocio.',
    'Las PARTES reconocen expresamente que el inmueble objeto de este contrato es en COMÚN Y PROINDIVISO razón por la cual las características son conformes al plano que se pone en conocimiento previo para que seleccione su aldea.',
  );
  xml = replaceText(xml, 'Contrato de Preventa de Bien Inmueble sobre Planos', 'Contrato de Preventa de Bien Inmueble en común y proindiviso');
  xml = replaceText(
    xml,
    'compraventa de predios sobre planos ubicados en el proyecto inmobiliario campestre',
    'compraventa de predios en común y proindiviso ubicados en el proyecto de subdivisión',
  );
  xml = replaceText(xml, 'sobre el proyecto, su naturaleza campestre,', 'sobre el proyecto, en común y proindiviso,');
  xml = replaceText(xml, 'contrato de promesa de compraventa de bien inmueble sobre planos,', 'contrato de promesa de compraventa de bien inmueble en común y proindiviso,');
  xml = replaceText(xml, 'naturaleza campestre del proyecto', 'naturaleza rural del proyecto');
  xml = replaceText(xml, 'CONTRATO DE PROMESA DE COMPRAVENTA DE BIEN INMUEBLE SOBRE PLANOS', 'CONTRATO DE PROMESA DE COMPRAVENTA DE BIEN INMUEBLE EN COMÚN Y PROINDIVISO');
  xml = replaceText(xml, 'El presente Contrato de Preventa de bien inmueble sobre planos', 'El presente Contrato de Preventa de bien inmueble en común y proindiviso');
  xml = replaceText(xml, 'CONCEPTO “SOBRE PLANOS”', 'CONCEPTO “EN COMÚN Y PROINDIVISO”');
  xml = replaceText(xml, 'la preventa de un bien inmueble sobre planos', 'la preventa de un bien inmueble en común y proindiviso');

  checkWellFormed(xml, 'preventa-sobre-montanas-2026');
  checkNoForbiddenText(xml, 'preventa-sobre-montanas-2026');

  zip.file('word/document.xml', xml);
  const outPath = path.join(TEMPLATES_DIR, 'preventa-sobre-montanas-2026.docx');
  fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('Generada:', outPath);
}

// ---------------------------------------------------------------------------
// 2. PROMESA SOBRE MONTAÑAS (PARTICIPACIÓN EN DERECHO DE DOMINIO)
// ---------------------------------------------------------------------------

function buildPromesaSobreMontanas() {
  const zip = new PizZip(fs.readFileSync(path.join(TEMPLATES_DIR, 'promesa-2026.docx')));
  let xml = zip.file('word/document.xml').asText();

  // Capturar estilos reales de párrafos de la base antes de reemplazar regiones
  const els = bodyElements(xml);
  const leadParaSample = xml.slice(els[11].start, els[11].end);
  const numConsidSample = xml.slice(els[12].start, els[12].end);
  const deliveryBulletSample = xml.slice(els[100].start, els[100].end);

  // 1. Título principal (solo el primer párrafo [0])
  xml = replaceText(xml, 'CONTRATO DE PROMESA DE COMPRAVENTA', 'CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL', { nth: 0 });

  // 2. Consideraciones + Objeto previo a tabla T1 (reemplaza [11..27])
  const introLead = cloneStyledPara(
    leadParaSample,
    'Quien(es) en el presente contrato se denominarán EL(LOS) PROMITENTE(S) COMPRADOR(ES): han convenido celebrar el presente contrato de COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, previas las siguientes CONSIDERACIONES:',
  );
  const considerations = [
    'Que el presente contrato se celebra dentro de una relación jurídica de consumo inmobiliario en la cual una persona jurídica dedicada profesionalmente a la promoción, gestión y comercialización de activos inmobiliarios ofrece en el mercado la transferencia de participaciones del derecho de dominio sobre un inmueble rural, mientras que EL(LOS) PROMITENTE(S) COMPRADOR(ES) interviene(n) en el negocio jurídico como destinatario final del bien. En tal virtud, el presente instrumento se rige por las disposiciones civiles aplicables al contrato de compraventa y, adicionalmente, por las normas de orden público previstas en la Ley 1480 de 2011, así como por las instrucciones administrativas vigentes impartidas por la Superintendencia de Industria y Comercio, particularmente aquellas relativas al deber reforzado de información en la comercialización de bienes inmuebles.',
    'Que EL VENDEDOR es titular del derecho de dominio sobre el inmueble rural descrito en el presente contrato, el cual se encuentra identificado en el respectivo folio de matrícula inmobiliaria expedido por la Oficina de Registro de Instrumentos Públicos competente, circunstancia que ha sido verificada por EL(LOS) PROMITENTE(S) COMPRADOR(ES) mediante el examen del certificado de tradición y libertad correspondiente.',
    'Que EL VENDEDOR ha decidido poner en circulación en el mercado participaciones del derecho de dominio que ostenta sobre dicho inmueble, manteniéndose en todo momento la unidad física y registral del predio, de manera que la transferencia de tales participaciones no constituye división material del terreno.',
    'Que el inmueble objeto del presente negocio jurídico corresponde a un predio rural de mayor extensión ubicado en jurisdicción del municipio de {proyecto.municipio}, departamento del Tolima, cuyas características físicas, extensión aproximada, linderos generales, ubicación geográfica y demás elementos de identificación han sido informados previamente al(los) PROMITENTE(S) COMPRADOR(ES), junto con la situación jurídica del bien y las condiciones generales que rigen su uso conforme al ordenamiento territorial vigente.',
    'Que EL VENDEDOR ha suministrado al(los) PROMITENTE(S) COMPRADOR(ES), de manera previa, suficiente, clara, veraz, verificable y comprensible, la totalidad de la información relevante relativa al inmueble y a la naturaleza jurídica de la operación, incluyendo, entre otros aspectos, la estructura del negocio jurídico, la naturaleza del derecho que se adquiere, las condiciones económicas del contrato, las modalidades de pago y el procedimiento mediante el cual se formalizará la transferencia del derecho de dominio mediante escritura pública e inscripción registral.',
    'Que EL(LOS) PROMITENTE(S) COMPRADOR(ES) declara haber recibido, examinado y comprendido la totalidad de la información suministrada por EL VENDEDOR, manifestando que la misma resultó suficiente para adoptar una decisión libre, consciente e informada respecto de la adquisición de la participación dominical objeto del presente contrato.',
    'Que las partes reconocen expresamente que el objeto del presente contrato consiste en la transferencia de una participación abstracta del derecho de dominio sobre la totalidad del inmueble descrito, razón por la cual la adquisición aquí pactada confiere al(los) PROMITENTE(S) COMPRADOR(ES) la titularidad sobre una cuota del derecho real de propiedad que se ejerce conjuntamente con los demás titulares del dominio sobre el bien.',
    'Que las partes reconocen igualmente que la coexistencia de varios titulares del derecho de dominio sobre el inmueble podrá dar lugar a la adopción de acuerdos de organización y administración destinados a regular el uso, aprovechamiento y gestión del predio, sin que tales acuerdos impliquen división jurídica del inmueble ni alteración de su unidad registral.',
    'Que la estructura jurídica del presente contrato ha sido diseñada de manera que la transferencia de participaciones no constituya fraccionamiento material del inmueble, preservándose en todo momento la unidad territorial y registral del terreno.',
    'Que las partes dejan expresa constancia de que la operación jurídica aquí celebrada implica la transferencia de participaciones del derecho de dominio sobre un mismo inmueble, manteniéndose incólume su unidad física y registral.',
    'Que todas las piezas informativas, comerciales o publicitarias utilizadas en la promoción de la presente operación fueron puestas en conocimiento del(los) PROMITENTE(S) COMPRADOR(ES) de manera previa a la celebración del contrato, garantizando que la información suministrada no induzca a error sobre la naturaleza jurídica del derecho adquirido ni sobre las características del inmueble objeto del negocio.',
    'Que EL VENDEDOR informó de manera expresa al(los) PROMITENTE(S) COMPRADOR(ES) las consecuencias económicas derivadas del eventual incumplimiento de las obligaciones contractuales, así como el alcance jurídico de las cláusulas relativas a arras, penalidades o cláusulas penales, garantizando transparencia contractual y respeto por los derechos del consumidor.',
    'Que el precio de la participación objeto del presente contrato fue determinado en pesos colombianos, corresponde al valor vigente al momento de la celebración del presente instrumento y fue objeto de negociación libre y consensuada entre las partes.',
    'Que el presente contrato fue puesto previamente a disposición del(los) PROMITENTE(S) COMPRADOR(ES) para su revisión integral, quien contó con la oportunidad real y efectiva de examinar su contenido, formular observaciones, solicitar aclaraciones y comprender plenamente su alcance jurídico antes de proceder a su suscripción.',
    'Que las partes reconocen que el presente instrumento constituye el acuerdo obligacional que regula la transferencia de la participación aquí pactada hasta tanto se otorgue la correspondiente escritura pública de compraventa y se realice su inscripción en el folio de matrícula inmobiliaria del inmueble, momento a partir del cual se perfeccionará la tradición del derecho transferido conforme a las reglas del derecho civil colombiano y al régimen registral vigente.',
    'Que el inmueble objeto del presente contrato se encuentra clasificado como suelo rural conforme al ordenamiento territorial vigente en el municipio de {proyecto.municipio}, por lo cual su uso y aprovechamiento se encuentra sujeto a las disposiciones del correspondiente esquema de ordenamiento territorial y demás normas urbanísticas aplicables.',
    'Que EL(LOS) PROMITENTE(S) COMPRADOR(ES) de participaciones sobre el inmueble actuarán de manera independiente y autónoma en la celebración del presente contrato, sin que entre ellos se configure sociedad de hecho, asociación empresarial, consorcio o cualquier otra forma de organización jurídica distinta de la coexistencia de titulares del derecho de dominio sobre un mismo bien.',
    'Que las partes reconocen que la eventual adopción de acuerdos privados de administración, organización o aprovechamiento del inmueble tendrá carácter meramente operativo y no producirá efectos de división jurídica del predio ni alterará la naturaleza del derecho adquirido por EL(LOS) PROMITENTE(S) COMPRADOR(ES).',
    'Que las partes actúan de buena fe, conforme al principio general que rige la formación, interpretación y ejecución de los contratos en el ordenamiento jurídico colombiano, declarando que el presente negocio jurídico refleja fielmente la voluntad real de los contratantes.',
  ].map((txt) => cloneStyledPara(numConsidSample, txt)).join('');

  const closingIntroAndClausulaPrimera = makePara([
    {
      text: 'Que en mérito de lo expuesto en las consideraciones anteriores las partes han aprobado el presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, mismo que se regirá por las siguientes CLÁUSULAS y en lo no reglado por ellas, por las disposiciones civiles y/o comerciales que resultaren aplicables y en especial para la protección de los derechos de LAS PARTES, por lo estipulado en la LEY 1480 DE 2011 y la CIRCULAR EXTERNA No. 004 DEL 12 DE NOVIEMBRE DE 2024 PROFERIDA POR LA SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO: ',
    },
    { text: 'CLAUSULA PRIMERA.- OBJETO:', bold: true, underline: true },
    {
      text: ' Por medio del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, el PROMITENTE VENDEDOR transfiere a favor del(los) PROMITENTE(S) COMPRADOR(ES), a título de compraventa, una participación del derecho de dominio que ostenta sobre la totalidad del inmueble rural descrito en este contrato, participación que corresponde a un área aproximada de {lote.area}, del pleno dominio del bien. Las partes declaran expresamente que el objeto de esta transferencia consiste en una cuota parte del derecho de dominio sobre la totalidad del inmueble, sin que la operación implique división física, ni fraccionamiento material del bien. Para todos los efectos, las partes acuerdan y así lo declaran que la participación que por medio del presente instrumento se adquiere corresponde a la fracción de terreno que a continuación se describe:',
    },
  ]);

  xml = replaceRegion(
    xml,
    (t) => t.startsWith('Quien(es) en el presente contrato se denominarán'),
    (t) => t.startsWith('Que en mérito de lo expuesto'),
    introLead + considerations + closingIntroAndClausulaPrimera,
  );

  // 3. Bloque posterior a tabla T1 ([30..42] de base -> linderos finca NAPOLES + parágrafos proindiviso)
  const postLotBlock = makePara([
    {
      text: 'Fracción de terreno que forma parte del proyecto Ecoturístico: “{proyecto.nombre}”, localizado en el predio rural de mayor extensión denominado "NAPOLES", ubicado en la vereda DOYARE, jurisdicción del municipio de {proyecto.municipio}, departamento del TOLIMA, de una cabida aproximada de setenta hectáreas (70.00 Has.), junto con todas sus anexidades y dependencias, usos, costumbres y servidumbres, alinderado especialmente así: Partiendo de Alvarado por la carreteable que va a Monserrate, hasta el punto denominado Balastera; de ahí trescientos treinta y cinco metros (335.00 mts) por la misma carreteable hasta encontrar el mojón número 1, de este continuando un recorrido de 2 kilómetros quinientos veinticinco metros (525.00 mts) hasta encontrar el mojón 2 a N 1\'42E, por el escurrimiento de agua hasta encontrar la cerca de alambre de púa y por esta hasta el mojón 3, que es donde empieza la cuchilla de la montaña, descendiendo por la cuchilla trescientos treinta y cinco metros (335.00 mts) al mojón 3 A y continuando por la cuchilla de la montaña que separa las quebradas cara de perro y cagalera, hasta la unión de las dos quebradas, por la quebrada se continúa cincuenta metros (5.00 mts) y se desvía S 13\'50\'E, para encontrar dos palmas, de estas a una distancia de setenta y ocho punto cincuenta metros (78.50 mts) y con una desviación de S 13\'30\'W, hasta la palma de cera y de esta a S 26\'43\'W mojón número 1 en la carretera que es el punto de partida. Inmueble identificado con la matrícula inmobiliaria número 350-75661 y ficha catastral número 0001-0048-000. ',
    },
    { text: 'Parágrafo Primero: NATURALEZA DE LA PARTICIPACIÓN DOMINICAL TRANSFERIDA.-', bold: true },
    {
      text: ' El presente contrato tiene por objeto la transferencia a favor del PROMITENTE COMPRADOR de una participación del derecho de dominio que EL VENDEDOR ostenta sobre el inmueble descrito en el presente instrumento. La participación transferida constituye una cuota del derecho real de propiedad sobre la totalidad del inmueble. ',
    },
    { text: 'Parágrafo Segundo: Publicidad e información vinculante.', bold: true },
    {
      text: ' El PROMITENTE VENDEDOR declara que las características del TERRENO ofrecidas de acuerdo al proyecto divisorio y demás instrumentos de comercialización corresponden a información real y verificable, suministrada dentro del PROCESO DE PREVENTA y que hace parte integral del presente contrato. Las partes reconocen que: — Las imágenes, renders y representaciones gráficas tienen carácter ilustrativo y no comprometen en nada al PROMITENTE VENDEDOR. — Las especificaciones técnicas vinculantes serán aquellas contenidas en los documentos técnicos oficiales del proyecto y en el presente contrato. — Cualquier modificación posterior, EL(LOS) PROMITENTE(S) COMPRADOR(ES) facultan desde ya al PROMITENTE VENDEDOR para realizar modificaciones que obedezcan a exigencias normativas, disposiciones de autoridad competente, fuerza mayor, caso fortuito o ajustes técnicos necesarios para la viabilidad del proceso divisorio. En ningún caso dichas modificaciones podrán implicar disminución sustancial de las condiciones ofrecidas ni configurarán publicidad engañosa, garantizándose el derecho del consumidor a recibir información actualizada y verificable. ',
    },
    { text: 'Parágrafo Tercero: INEXISTENCIA DE SEGREGACIÓN O FRACCIONAMIENTO PREDIAL.-', bold: true },
    {
      text: ' Las partes dejan expresa constancia de que la transferencia aquí pactada no constituye fraccionamiento predial ni parcelación del inmueble, manteniéndose inalterada la unidad registral y territorial del predio identificado en el correspondiente folio de matrícula inmobiliaria. En consecuencia, la presente operación jurídica no contraviene las restricciones previstas en la legislación agraria colombiana relativas a la subdivisión de predios rurales por debajo de la extensión mínima correspondiente a la Unidad Agrícola Familiar conforme a lo dispuesto en la Ley 160 de 1994. ',
    },
    { text: 'Parágrafo Cuarto: Independencia del proceso precontractual.', bold: true },
    {
      text: ' El objeto aquí descrito materializa los acuerdos alcanzados en el PROCESO DE PREVENTA, cuyos documentos soporte se integran como anexos del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL. No obstante, con la suscripción del presente instrumento cesan los efectos jurídicos autónomos del contrato de preventa, quedando este absorbido por la promesa como único título obligacional vigente hasta la escritura pública. ',
    },
    { text: 'Parágrafo Quinto: RÉGIMEN DE USO Y APROVECHAMIENTO DEL INMUEBLE.-', bold: true },
    {
      text: ' El uso, aprovechamiento y explotación del inmueble se realizará conforme a las normas aplicables al suelo rural establecidas en el respectivo instrumento de ordenamiento territorial del municipio de {proyecto.municipio} y en las disposiciones legales vigentes sobre uso del suelo rural. EL(LOS) PROMITENTE(S) COMPRADOR(ES) se obliga a respetar las normas ambientales, agrarias, urbanísticas y administrativas que regulan el aprovechamiento del suelo rural. En ningún caso el ejercicio del derecho adquirido podrá implicar actividades que alteren la naturaleza jurídica del inmueble ni que impliquen procesos de urbanización o parcelación rural sometidos a licenciamiento urbanístico.',
    },
  ]);

  xml = replaceRegion(
    xml,
    (t) => t.trim() === '{#proyecto.esLlanoGrande}' || t.startsWith('Las partes reconocen que, por tratarse de un CONTRATO'),
    (t) => t.startsWith('Parágrafo Primero: Naturaleza del bien prometido.'),
    postLotBlock,
  );
  // Eliminar la etiqueta residual {#proyecto.esLlanoGrande} que hubiera quedado entre T1 y el bloque anterior si no coincidió exacto
  xml = replaceText(xml, '{#proyecto.esLlanoGrande}', '', { min: 0 });
  xml = replaceText(xml, '{/proyecto.esLlanoGrande}', '', { min: 0 });

  // 4. Cláusula Segunda encabezado (manteniendo las tablas T2, T3, T4, T5 intactas)
  xml = replaceText(xml, 'el precio total del TERRENO prometido en venta es la suma', 'el precio total de la participación sobre el TERRENO prometida en venta es la suma');
  xml = replaceText(xml, 'presente CONTRATO DE PROMESA DE COMPRAVENTA DE BIEN INMUEBLE SOBRE PLANOS', 'presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL');

  // 5. Cláusulas Tercera, Cuarta, Quinta y Sexta (antes de tabla T6 de Arras)
  const clauses3to6 =
    makePara([
      { text: 'Parágrafo Primero:', bold: true },
      { text: ' En ningún caso podrán exigirse pagos distintos a los aquí expresamente pactados.' },
    ]) +
    makePara([
      {
        text: 'Todos los pagos deberán efectuarse a las cuentas oficiales del PROMITENTE VENDEDOR previamente informadas por escrito, garantizando trazabilidad financiera y cumplimiento de las normas sobre prevención de lavado de activos. ',
      },
      { text: 'Parágrafo Segundo: Naturaleza de las sumas entregadas.', bold: true },
      {
        text: ' Las sumas pagadas a la suscripción del presente contrato tendrán la naturaleza jurídica de ARRAS CONFIRMATORIAS, imputables al precio, conforme a lo dispuesto en el Código Civil, y cumplirán función de garantía recíproca del cumplimiento contractual. Las partes acuerdan expresamente que dichas arras: — No constituyen cláusula penal automática. — No operan de pleno derecho. — No excluyen el derecho de la parte cumplida a exigir el cumplimiento o la resolución judicial del contrato con indemnización de perjuicios cuando a ello haya lugar. ',
      },
      { text: 'Parágrafo Tercero: Incumplimiento del PROMITENTE COMPRADOR.', bold: true },
      {
        text: ' En caso de incumplimiento grave, objetivo y verificable DEL(LOS) PROMITENTE(S) COMPRADOR(ES) respecto del pago del precio en los términos pactados, el PROMITENTE VENDEDOR deberá: 1. Requerir formalmente el cumplimiento concediendo un plazo adicional razonable no inferior a quince (15) días calendario. 2. Informar de manera expresa las consecuencias económicas del eventual incumplimiento. 3. Ofrecer alternativa de normalización cuando sea viable. Solo vencido dicho plazo sin que el incumplimiento haya sido subsanado, el PROMITENTE VENDEDOR podrá solicitar la resolución del contrato. En este caso, las arras serán retenidas para compensar los perjuicios efectivamente causados al PROMITENTE VENDEDOR. ',
      },
      { text: 'Parágrafo Cuarto: Incumplimiento del PROMITENTE VENDEDOR.', bold: true },
      {
        text: ' En caso de incumplimiento grave, objetivo y verificable del PROMITENTE VENDEDOR, EL(LOS) PROMITENTE(S) COMPRADOR(ES) tendrá derecho a: Exigir el cumplimiento del contrato; o Solicitar la resolución del mismo. En caso de resolución imputable al PROMITENTE VENDEDOR, este deberá restituir la totalidad de las sumas pagadas, debidamente actualizadas conforme al IPC certificado por autoridad competente. ',
      },
      { text: 'Parágrafo Quinto: Desistimiento.', bold: true },
      {
        text: ' Las partes reconocen que el presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL no se encuentra sometido al derecho de retracto previsto para ventas a distancia, por tratarse de bien inmueble, sin perjuicio de que: — Si el desistimiento obedece a incumplimiento del PROMITENTE VENDEDOR, no habrá penalidad alguna para el consumidor. — Si el desistimiento unilateral del consumidor ocurre sin causa imputable al PROMITENTE VENDEDOR, se aplicarán las reglas de arras confirmatorias en los términos aquí establecidos, garantizando proporcionalidad y ausencia de cláusula abusiva. ',
      },
      { text: 'Parágrafo Sexto: Transparencia económica.', bold: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES) declara que: — Conoce el valor total que deberá pagar hasta la escrituración. — Conoce los gastos notariales, impuestos y costos registrales que legalmente le correspondan. — Fue informado de los plazos estimados para la elevación a escritura pública. — Entiende las consecuencias económicas de un eventual incumplimiento. — Condiciones suspensivas. — Control de retrasos sin generar responsabilidad objetiva automática. ',
      },
      { text: 'CLÁUSULA TERCERA: CONDICIONES ESPECIALES QUE MODULAN EL PRECIO Y/O LA FORMA DE PAGO:', bold: true, underline: true },
      {
        text: ' Las partes, obrando de común acuerdo establecen y aceptan que el precio y la forma de pago estipulados en la CLÁUSULA SEGUNDA del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL podrán estar sujetos a beneficios comerciales previamente informados dentro del PROCESO DE PREVENTA, los cuales constan expresamente en el CONTRATO DE PREVENTA y/o en documento anexo suscrito por las partes. Los beneficios comerciales, incluidos bonos de descuento, incentivos promocionales o planes comerciales especiales tendrán naturaleza estrictamente promocional y estarán condicionados al cumplimiento integral, oportuno y verificable del plan de pagos pactado. Dichos descuentos o bonos se aplicarán al momento de expedir el correspondiente paz y salvo. No obstante, la pérdida de tales beneficios no operará de manera automática ni de pleno derecho. Para que proceda su revocatoria, el PROMITENTE VENDEDOR deberá: 1. Informar por escrito AL(LOS) PROMITENTE(S) COMPRADOR(ES) el retraso registrado. 2. Conceder un plazo de gracia razonable no inferior a diez (10) días calendario para subsanar la mora. 3. Indicar expresamente el impacto económico que tendría la pérdida del beneficio. Si vencido el plazo otorgado no se ha normalizado el pago, el beneficio podrá ser revocado proporcionalmente, siempre que: — El incumplimiento sea imputable AL(LOS) PROMITENTE(S) COMPRADOR(ES). — La revocatoria sea coherente con la naturaleza del incentivo. — No implique una sanción adicional distinta a la pérdida del beneficio mismo. En ningún caso la pérdida del beneficio podrá convertirse en cláusula penal encubierta ni generar un cobro superior al valor real del descuento otorgado. Cuando el beneficio consista en la aplicación diferida de un descuento al finalizar el plan de pagos, este solo se hará efectivo una vez verificado el cumplimiento total del cronograma. Si existieren retrasos subsanados dentro del plazo de gracia, no se considerará incumplimiento para efectos de pérdida automática del beneficio. ',
      },
      { text: 'Parágrafo Primero: Canales autorizados de pago.', bold: true },
      {
        text: ' Con el fin de garantizar trazabilidad financiera y seguridad jurídica, los pagos deberán realizarse exclusivamente a favor del PROMITENTE VENDEDOR, utilizando los canales oficiales. Todos los pagos se deben realizar únicamente a favor de EL PROMITENTE VENDEDOR, empleando para su validez el NÚMERO DE REFERENCIA: {lote.codigo} y realizarse únicamente a través de uno de los siguientes canales autorizados: A) Consignación Bancaria: A la cuenta de Ahorros No. 168770042765 del Banco Davivienda, con el número de convenio 1171362 (Si la consignación es a nivel nacional, EL(LOS) PROMITENTE(S) COMPRADOR(ES) cancelará(n) el valor de la comisión y demás costos financieros a que hubiere lugar por dicha transacción, para lo cual debe tener en cuenta que dichos valores serán descontados directamente por la entidad financiera y por lo tanto no se verán reflejados en el valor final depositado a favor de EL PROMITENTE VENDEDOR), a nombre de {vendedor.razonSocial}. B) Pago vía PSE a través de la página web www.grupoconstructormeraki.com.co/pagos/. C) Pagos en efectivo: Serán solo admisibles aquellos pagos efectuados DIRECTAMENTE en las oficinas de EL PROMITENTE VENDEDOR, ubicadas en la Carrera 3 # 42-92 Barrio Casa Club de la ciudad de Ibagué-Tolima, los cuales se acreditarán mediante RECIBO DE CAJA y solo ante la persona autorizada para recibir dinero, es decir, quien ostente el cargo de tesorero(a) de la compañía {vendedor.razonSocial}. Consecuencia de lo anterior, los pagos realizados en otras cuentas o pagados a personas distintas a las autorizadas no tendrán validez alguna ni serán aceptados ni reconocidos por EL PROMITENTE VENDEDOR. ',
      },
      { text: 'Parágrafo Segundo:', bold: true },
      {
        text: ' Los costos financieros que cobre la entidad bancaria por consignaciones nacionales, transacciones electrónicas, tarjetas de crédito, giros internacionales entre otros, serán asumidos por EL PROMITENTE COMPRADOR; dicha condición fue previamente informada de manera clara y previa al momento del CONTRATO DE PREVENTA. ',
      },
      { text: 'Parágrafo Tercero:', bold: true },
      {
        text: ' En ningún caso el PROMITENTE VENDEDOR podrá desconocer pagos efectivamente realizados a los canales oficiales autorizados, ni podrá exigir pagos por medios distintos a los informados contractualmente. ',
      },
      { text: 'Parágrafo Cuarto: Transparencia y equilibrio.', bold: true },
      {
        text: ' Las partes declaran que: — Las condiciones especiales aquí reguladas fueron previamente informadas. — Se explicó su impacto económico real. — EL(LOS) PROMITENTE(S) COMPRADOR(ES) comprendió las consecuencias de su aplicación. — No existe modificación unilateral del precio. ',
      },
      { text: 'Parágrafo Quinto:', bold: true },
      { text: ' Cualquier modificación futura relacionada con beneficios comerciales requerirá acuerdo escrito entre las partes y no podrá imponerse unilateralmente.', },
    ]) +
    makePara([
      { text: 'CLÁUSULA CUARTA: GASTOS ADMINISTRATIVOS, IMPUESTOS Y CONTRIBUCIONES:', bold: true, underline: true },
      {
        text: ' Las partes acuerdan y así lo declaran expresamente que los impuestos, incluido el de valorización, y las contribuciones que se lleguen a causar, liquidar o reajustar con posterioridad a la fecha de otorgamiento de la escritura pública de compraventa de los derechos objeto del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, estarán a cargo exclusivo de EL(LOS) PROMITENTE(S) COMPRADOR(ES), siempre que correspondan a períodos fiscales o hechos generadores posteriores a dicha fecha. En consecuencia, todo impuesto, tasa o contribución cuyo hecho generador sea anterior a la fecha de otorgamiento de la escritura pública será asumido por EL PROMITENTE VENDEDOR, garantizando así la distribución proporcional y legal de las cargas conforme a la normativa vigente. Cualquier otro gasto administrativo derivado del uso, goce o mantenimiento de los derechos sobre el bien inmueble, tales como servicios públicos domiciliarios efectivamente instalados, cuotas ordinarias de administración, vigilancia o similares, será asumido por EL(LOS) PROMITENTE(S) COMPRADOR(ES) a partir de la fecha de otorgamiento de la escritura pública y entrega material, lo que ocurra primero, siempre que el servicio o beneficio se encuentre disponible y en funcionamiento. ',
      },
      { text: 'CLÁUSULA QUINTA: OTROS GASTOS.-', bold: true, underline: true },
      {
        text: ' Todo costo adicional que se origine exclusivamente por requerimientos particulares, modificaciones voluntarias o solicitudes especiales formuladas por EL(LOS) PROMITENTE(S) COMPRADOR(ES), y que no se encuentren previstos dentro del objeto, alcance o condiciones normales del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, será asumido por EL(LOS) PROMITENTE(S) COMPRADOR(ES). En todo caso, para que dichos costos sean exigibles, deberán cumplirse las siguientes condiciones: a) Que el requerimiento haya sido presentado por escrito por EL(LOS) PROMITENTE(S) COMPRADOR(ES). b) Que EL PROMITENTE VENDEDOR haya informado previamente el valor estimado del trámite o gestión. c) Que exista aceptación expresa y escrita del costo por parte de EL(LOS) PROMITENTE(S) COMPRADOR(ES). Parágrafo: En ningún caso podrán trasladarse a EL(LOS) PROMITENTE(S) COMPRADOR(ES) costos que correspondan a obligaciones legales propias del PROMITENTE VENDEDOR ni aquellos derivados de trámites necesarios para la viabilidad jurídica del proyecto. ',
      },
      { text: 'CLÁUSULA SEXTA: ARRAS.-', bold: true, underline: true },
      {
        text: ' Las partes acuerdan y así lo declaran expresamente que fijan la cuantía por concepto de ARRAS CONFIRMATORIAS en el TREINTA (30%) POR CIENTO del valor total pactado en la cláusula segunda del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL, equivalente a:',
      },
    ]);

  xml = replaceRegion(
    xml,
    (t) => t.startsWith('Parágrafo Primero:  En ningún caso') || t.startsWith('Parágrafo Primero: En ningún caso'),
    (t) => t.startsWith('CLÁUSULA CUARTA: GASTOS ADMINISTRATIVOS'),
    clauses3to6,
  );

  // 6. Cláusulas Séptima a Vigésimo Novena (después de los incisos de Arras [98..105], antes de DIRECCIONES DE NOTIFICACIÓN)
  const deliveryBullet1 = cloneStyledPara(
    deliveryBulletSample,
    'La entrega se efectuará dentro de los quince (15) días hábiles siguientes a la firma y que previamente se haya suscrito la escritura pública.',
  );
  const deliveryBullet2 = cloneStyledPara(
    deliveryBulletSample,
    'La participación sobre el inmueble será entregada conforme a la topografía natural, reconociendo las partes que las variaciones de cabida o ubicación que obedezcan a modulaciones técnicas, urbanísticas o topográficas no constituirán incumplimiento siempre que se encuentren dentro de los márgenes permitidos por la normativa aplicable y no afecten sustancialmente la destinación económica del bien; si la variación superare los límites legales y generare impacto directo en el precio, las partes realizarán el ajuste proporcional correspondiente.',
  );
  const deliveryBullet3 = cloneStyledPara(
    deliveryBulletSample,
    'De la diligencia de entrega se levantará acta suscrita por ambas partes en la que se dejará constancia detallada del estado del inmueble y de las observaciones que formule EL(LOS) PROMITENTE(S) COMPRADOR(ES). Las observaciones razonables y verificables serán atendidas por el PROMITENTE VENDEDOR dentro de un término prudencial acorde con su naturaleza técnica. En caso de inasistencia injustificada de EL(LOS) PROMITENTE(S) COMPRADOR(ES) a la fecha previamente acordada para la entrega, se fijará una nueva fecha dentro de un plazo razonable; solo ante renuencia reiterada y sin causa objetiva podrá dejarse constancia mediante acta suscrita con testigos, sin que ello implique limitación de los derechos legales del consumidor ni presunción automática de aceptación del estado del inmueble.',
  );

  const clauses7to29 =
    makePara([
      { text: 'CLÁUSULA SÉPTIMA: ORIGEN DE FONDOS Y DESTINO DE LOS ACTIVOS.-', bold: true, underline: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES), declara(n) que el origen de los recursos con los que promete(n) adquirir el TERRENO descrito en la cláusula primera del presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL proviene de ocupación, oficio, profesión, actividad o negocio lícito. Así mismo, manifiesta(n) que los recursos entregados no provienen de actividades ilícitas contempladas en el ordenamiento jurídico colombiano, ni en normas que lo modifiquen o adicionen, y que los activos objeto de adquisición no tendrán destinación ilícita. EL PROMITENTE VENDEDOR podrá apoyarse en la información suministrada por EL(LOS) PROMITENTE(S) COMPRADOR(ES) para efectos de cumplir sus obligaciones legales en materia de prevención de lavado de activos y financiación del terrorismo. En caso de que la información suministrada resulte falsa, inexacta u omisiva y ello genere consecuencias legales directas para EL PROMITENTE VENDEDOR, EL(LOS) PROMITENTE(S) COMPRADOR(ES) asumirá(n) la responsabilidad correspondiente, sin que ello implique exoneración automática del deber de verificación que la ley impone al PROMITENTE VENDEDOR.',
      },
    ]) +
    makePara([
      { text: 'Parágrafo. INCLUSIÓN EN LISTADOS DE CONTROL.', bold: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES) declara(n) que ni ellos, ni sus accionistas, representantes legales o administradores, se encuentran incluidos en listados restrictivos de autoridades nacionales o extranjeras en materia de lavado de activos o financiación del terrorismo, tales como los administrados por la OFAC o por las Naciones Unidas. El PROMITENTE VENDEDOR podrá verificar esta información en cumplimiento de sus deberes legales. ',
      },
      { text: 'CLÁUSULA OCTAVA: ACCIONES LEGALES, DEMANDAS Y PROCESOS:', bold: true, underline: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES), declara(n) que a la fecha de suscripción del presente contrato no cursan en su contra litigios, investigaciones o procesos judiciales o administrativos que afecten de manera directa su capacidad jurídica o financiera para cumplir las obligaciones aquí asumidas. Igualmente, manifiesta(n) que no se encuentran incursos en procesos de reorganización o insolvencia que limiten su capacidad de disposición patrimonial, y que informarán oportunamente al PROMITENTE VENDEDOR cualquier circunstancia sobreviniente que pueda afectar el cumplimiento del contrato. La eventual existencia de procesos judiciales no implicará automáticamente la terminación del contrato, salvo que dichos procesos generen una imposibilidad real y demostrable de cumplir las obligaciones económicas aquí pactadas. ',
      },
      { text: 'CLÁUSULA NOVENA: MORA.-', bold: true, underline: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES), incurrirá(n) en mora cuando, vencido el plazo pactado para el cumplimiento de cualquiera de sus obligaciones económicas, no hubiere(n) efectuado el pago correspondiente. No obstante, antes de declarar la mora con efectos resolutorios o indemnizatorios, EL PROMITENTE VENDEDOR deberá notificar por escrito el incumplimiento, concediendo un plazo de gracia no inferior a quince (15) días calendario para subsanar la obligación. Solo vencido dicho término sin que se produzca el pago, podrán activarse las consecuencias previstas en la cláusula sexta relativa a arras, conforme al procedimiento allí establecido. En ningún caso la mora producirá la resolución automática del contrato ni la pérdida inmediata de las sumas pagadas sin el cumplimiento del procedimiento previo. Parágrafo primero: En caso de mora efectiva, se causarán intereses moratorios a la tasa máxima legal permitida, liquidados sobre los saldos de capital vencidos, desde la fecha de configuración formal de la mora hasta la fecha de pago. Parágrafo segundo. La mora superior a quince (15) días calendario posteriores al vencimiento y debidamente notificada facultará al PROMITENTE VENDEDOR para iniciar el procedimiento de aplicación de arras conforme a la cláusula sexta, respetando los principios de proporcionalidad y equilibrio contractual. ',
      },
      { text: 'CLÁUSULA DÉCIMA: ACELERATORIA:', bold: true, underline: true },
      {
        text: ' Las partes acuerdan y manifiestan que pactan una CLÁUSULA ACELERATORIA, que operará en los siguientes eventos: a) En caso de existir acuerdo de pago posterior y presentarse mora en cualquiera de las cuotas allí establecidas, el PROMITENTE VENDEDOR podrá declarar vencido el saldo pendiente, siempre que el incumplimiento sea objetivo y verificable y haya sido informado AL(LOS) PROMITENTE(S) COMPRADOR(ES). b) En caso de que EL(LOS) PROMITENTE(S) COMPRADOR(ES) se sometan a proceso de reorganización o insolvencia que afecte de manera real su capacidad de pago, el PROMITENTE VENDEDOR podrá declarar vencido el saldo pendiente o iniciar el procedimiento contractual correspondiente. La aplicación de la cláusula aceleratoria no impedirá al PROMITENTE COMPRADOR ejercer las excepciones legales procedentes ni resolver el contrato cuando resulte viable excepcionar incumplimiento del PROMITENTE VENDEDOR, conforme al artículo 43 numeral 8 de la Ley 1480 de 2011. ',
      },
      { text: 'CLÁUSULA DÉCIMA PRIMERA: INOPERANCIA DEL DERECHO DE RETRACTO:', bold: true, underline: true },
      {
        text: ' Las partes dejan constancia de que el derecho de retracto previsto en el artículo 47 de la Ley 1480 de 2011 aplica únicamente en los supuestos allí establecidos. Tratándose de la compraventa de participación en derecho de dominio sobre predio rural, dicho derecho solo procederá cuando la operación encuadre en las hipótesis legales (ventas a distancia, financiación directa del proveedor, tiempos compartidos u otras previstas en la norma), lo cual deberá evaluarse en cada caso concreto. De acuerdo con lo señalado en la Sentencia 1598 del 2018 de la Superintendencia de Industria y Comercio, no opera el derecho de retracto, condición que ha sido informada a EL(LOS) PROMITENTE(S) COMPRADOR(ES), quien(es) manifiesta(n) que le ha sido suministrada la información pertinente y así lo acepta expresamente. ',
      },
      { text: 'CLÁUSULA DÉCIMA SEGUNDA: PACTO COMISORIO.-', bold: true, underline: true },
      {
        text: ' Queda estipulado expresamente por las partes que el incumplimiento de las obligaciones esenciales del presente contrato facultará a la parte cumplida para solicitar su resolución. La resolución podrá declararse sin necesidad de pronunciamiento judicial cuando el incumplimiento sea claro, objetivo y verificable. EL(LOS) PROMITENTE(S) COMPRADOR(ES) podrá(n) enervar la resolución pagando las sumas vencidas con intereses legales dentro del término de sesenta (60) días contados desde la notificación de la resolución. La aplicación de la presente cláusula no impedirá al consumidor resolver el contrato cuando resulte procedente excepcionar el incumplimiento del PROMITENTE VENDEDOR, conforme al artículo 43 numeral 8 de la Ley 1480 de 2011. Declarada la resolución, podrá aplicarse la cláusula de arras en los términos allí establecidos e informados en etapa precontractual. ',
      },
      { text: 'CLÁUSULA DÉCIMA TERCERA: GARANTÍAS:', bold: true, underline: true },
      {
        text: ' EL PROMITENTE VENDEDOR podrá solicitar garantías reales o personales adicionales cuando existan circunstancias objetivas que afecten la capacidad de pago del PROMITENTE COMPRADOR. Dicha solicitud deberá ser proporcional al saldo insoluto y no podrá constituir una carga desproporcionada ni implicar modificación unilateral del contrato. ',
      },
      { text: 'CLÁUSULA DÉCIMA CUARTA: LEGISLACIÓN APLICABLE:', bold: true, underline: true },
      {
        text: ' Las partes establecen que el presente CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL se regirá por los Títulos VI y XII del segundo libro del Código Civil colombiano; el Código de Comercio en lo pertinente, la Ley 1480 de 2011, la Circular Externa 004 de 2024 de la Superintendencia de Industria y Comercio y demás normas concordantes. ',
      },
      { text: 'CLÁUSULA DÉCIMA QUINTA: EXIGIBILIDAD Y MÉRITO EJECUTIVO:', bold: true, underline: true },
      {
        text: ' Las partes acuerdan que el presente documento prestará mérito ejecutivo respecto de las obligaciones claras, expresas y exigibles contenidas en él, conforme a la ley procesal vigente. La exigibilidad de las sumas derivadas del incumplimiento deberá fundarse en hechos verificables y en obligaciones determinadas, para lo cual bastará con la sola afirmación unilateral del PROMITENTE VENDEDOR. El ejercicio de la acción ejecutiva no impedirá al consumidor ejercer las excepciones legales correspondientes. El pago de la pena o aplicación de arras no extinguirá automáticamente la obligación principal salvo liquidación contractual expresa. ',
      },
      { text: 'CLÁUSULA DÉCIMA SEXTA: ENTREGA MATERIAL:', bold: true, underline: true },
      {
        text: ' Las partes acuerdan que EL PROMITENTE VENDEDOR se obliga a realizar la entrega real y material de los derechos sobre el inmueble objeto del presente contrato dentro del término pactado para el perfeccionamiento de la compraventa mediante escritura pública y una vez se hayan cumplido íntegramente las obligaciones contractuales a cargo de EL(LOS) PROMITENTE(S) COMPRADOR(ES). La entrega comprenderá el área de terreno correspondiente a la participación adquirida sobre el bien inmueble individualizado en la cláusula primera, con sus anexidades, linderos y mojones ofrecidos en la etapa precontractual. La entrega de que trata la presente cláusula estará regulada entre otras por las siguientes estipulaciones:',
      },
    ]) +
    deliveryBullet1 +
    deliveryBullet2 +
    deliveryBullet3 +
    makePara([
      { text: 'CLÁUSULA DÉCIMA SÉPTIMA: CONDICIONES DE LIBERTAD Y OTROS GRAVÁMENES:', bold: true, underline: true },
      {
        text: ' EL PROMITENTE VENDEDOR se obliga a transferir los derechos de que trata el presente contrato, libres de embargos, gravámenes, hipotecas, censos, anticresis, contratos de arrendamiento por escritura pública, desmembraciones, condiciones resolutorias y patrimonio de familia. Asimismo, se obliga a salir al saneamiento de la venta del inmueble, en los casos previstos en la ley y especialmente a responder por cualquier gravamen o acción real que resulte en contra del derecho de dominio que se transferirá a EL(LOS) PROMITENTE(S) COMPRADOR(ES). ',
      },
      { text: 'CLÁUSULA DÉCIMA OCTAVA: OTORGAMIENTO DE ESCRITURAS PÚBLICAS:', bold: true, underline: true },
      {
        text: ' En cumplimiento de lo preceptuado en el Código Civil, LAS PARTES acuerdan que EL(LOS) PROMITENTE(S) COMPRADOR(ES) suscribirán la escritura pública de transferencia de dominio de los derechos prometidos en venta, de la siguiente manera:',
      },
    ]) +
    makePara(
      'a. PARA CONTRATOS CUYO PERIODO DE PAGOS SE PACTE ENTRE 0 Y 12 MESES: transcurridos dieciocho (18) meses contados a partir del día siguiente a la firma del presente contrato, a las 9:00 a.m., en la Notaría Séptima de la ciudad de Ibagué.',
      { firstLine: 0 },
    ) +
    makePara(
      'b. PARA CONTRATOS CUYO PERIODO DE PAGOS SE PACTE ENTRE 13 Y 24 MESES: transcurridos tres (03) meses contados a partir del día siguiente a la firma del presente contrato, a las 9:00 a.m., en la Notaría Séptima de la ciudad de Ibagué.',
      { firstLine: 0 },
    ) +
    makePara([
      {
        text: 'El representante legal de EL PROMITENTE VENDEDOR lo hará dentro de los diez (10) días hábiles siguientes a la firma de LOS PROMITENTES COMPRADORES. ',
      },
      { text: 'PARÁGRAFO PRIMERO:', bold: true },
      {
        text: ' Las Partes estatuyen como requisitos para proceder a la firma de la escritura lo siguiente: 1. Que EL(LOS) PROMITENTE(S) COMPRADOR(ES) haya cancelado la totalidad de los valores correspondientes a la cuota inicial y el saldo a pagar establecido en la CLÁUSULA SEGUNDA de este contrato y presente el respectivo certificado de Paz y Salvo expedido por el área administrativa del {vendedor.razonSocial}. 2. Que la participación adquirida sobre el bien inmueble objeto de este contrato se encuentre completamente individualizada con el fin de realizar el registro ante la Oficina de Instrumentos Públicos de la jurisdicción correspondiente. ',
      },
      { text: 'PARÁGRAFO SEGUNDO:', bold: true },
      {
        text: ' En cumplimiento de lo dispuesto en la CIRCULAR EXTERNA 004 DE NOVIEMBRE DE 2024 PROFERIDA POR LA SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO, en caso de que existan circunstancias que impliquen la modificación de estas fechas, deberá informarse de ello a LOS PROMITENTES COMPRADORES de forma oportuna Y LA NUEVA FECHA SE DETERMINARÁ DE COMÚN ACUERDO ENTRE LAS PARTES, teniendo en cuenta que las modificaciones unilaterales están prohibidas por la Ley 1480 de 2011. ',
      },
      { text: 'CLÁUSULA DÉCIMA NOVENA: GASTOS NOTARIALES Y DE REGISTRO:', bold: true, underline: true },
      {
        text: ' Los gastos notariales que se ocasionen con el otorgamiento de la escritura pública de compraventa serán sufragados por partes iguales entre EL PROMITENTE VENDEDOR y EL(LOS) PROMITENTE(S) COMPRADOR(ES). Los gastos para el registro de la escritura pública, incluyendo el impuesto de registro, estarán a cargo de EL(LOS) PROMITENTE(S) COMPRADOR(ES). La retención en la fuente será cancelada por EL PROMITENTE VENDEDOR. PARÁGRAFO PRIMERO: Los gastos que impliquen la expedición de copias destinadas a EL(LOS) PROMITENTE(S) COMPRADOR(ES), a la entidad otorgante del crédito, a la Oficina de Instrumentos Públicos, al protocolo de la respectiva Notaría y cualquier otra copia que EL(LOS) PROMITENTE(S) COMPRADOR(ES) soliciten, las autenticaciones, diligencias y hoja matriz, impuesto a las ventas o cualquier otro gasto o costo derivado del otorgamiento de la escritura pública de venta serán asumidos en su totalidad por EL(LOS) PROMITENTE(S) COMPRADOR(ES). PARÁGRAFO SEGUNDO: Una vez firmada y entregada la correspondiente Escritura Pública por parte de la Notaría, EL(LOS) PROMITENTE(S) COMPRADOR(ES) deberán llevar dicho instrumento ante la Oficina de Registro de Instrumentos Públicos correspondiente, a más tardar dentro de los tres (3) días hábiles siguientes, con el propósito de registrar la transferencia del dominio. ',
      },
      { text: 'CLÁUSULA VIGÉSIMA: CESIÓN.', bold: true, underline: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES) se obligan a no ceder a ningún título los derechos y obligaciones que para él se derivan del presente contrato sin autorización expresa y escrita de EL PROMITENTE VENDEDOR, y que éste acepte al nuevo solicitante mediante el diligenciamiento de los requisitos exigidos por la constructora, cancelando la suma equivalente al 5% sobre el valor total del presente contrato y que el pago de las obligaciones contraídas por parte de EL(LOS) PROMITENTE(S) COMPRADOR(ES) se encuentre al día, incluyendo aquellas a título de costos y gastos administrativos, mismas que serán imputables al precio del contrato. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO PRIMERA: IMPREVISTOS Y FUERZA MAYOR.-', bold: true, underline: true },
      {
        text: ' En cumplimiento de lo dispuesto por la CIRCULAR EXTERNA 004 DE NOVIEMBRE DE 2024, EMANADA DE LA SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO, LAS PARTES contratantes acuerdan expresamente que la oportunidad prevista para la entrega del inmueble prometido en compraventa se estimó con base en el programa que EL PROMITENTE VENDEDOR elaboró para la construcción del proyecto. Sin embargo, el desarrollo de esta clase de obras está sujeto a las contingencias propias del suministro de materiales, cumplimiento de contratistas, al logro del punto de equilibrio del 80% en ventas del proyecto para iniciar las obras de adecuación y en general, a imprevistos ajenos a EL PROMITENTE VENDEDOR. En consecuencia, ocurridas cualquiera de las circunstancias que retrasen la obra, EL PROMITENTE VENDEDOR informará de estas circunstancias a EL(LOS) PROMITENTE(S) COMPRADOR(ES), así como de las modificaciones en la fecha de entrega del inmueble y de la escritura pública. PARÁGRAFO PRIMERO: No obstante lo dispuesto en la cláusula anterior, en el evento en que los inmuebles no puedan ser entregados por causa de fuerza mayor o caso fortuito, esta circunstancia no generará responsabilidad legal ni patrimonial alguna por parte de EL PROMITENTE VENDEDOR. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO SEGUNDA: CLÁUSULA COMPROMISORIA, SOLUCIÓN DE CONFLICTOS CONTRACTUALES; JURISDICCIÓN Y COMPETENCIA:', bold: true, underline: true },
      {
        text: ' Las partes acuerdan que cualquier diferencia, discrepancia, controversia o conflicto que surja con ocasión de la celebración, ejecución, interpretación, terminación o liquidación del presente contrato será tramitada inicialmente mediante mecanismos alternativos de solución de conflictos, privilegiando el arreglo directo entre las partes y, en su defecto, la conciliación en derecho conforme a lo dispuesto en la Ley 2220 de 2022 y las normas que la modifiquen o sustituyan. La utilización de dichos mecanismos no constituirá requisito de procedibilidad obligatorio cuando la ley no lo exija, ni implicará renuncia a derechos irrenunciables del consumidor, ni limitación al ejercicio de acciones ante autoridades administrativas o judiciales competentes cuando así lo autorice el ordenamiento jurídico. En caso de que la controversia no pueda resolverse mediante arreglo directo o conciliación, las partes podrán someterla a decisión arbitral, siempre que EL(LOS) PROMITENTE(S) COMPRADOR(ES) manifieste de manera libre, expresa e informada su aceptación al momento de surgir la controversia o ratifique válidamente la presente estipulación conforme a la normativa vigente. El tribunal que eventualmente se conforme decidirá en derecho y se regirá por lo dispuesto en la Ley 1563 de 2012 y las normas que la adicionen, modifiquen o sustituyan. El tribunal estará integrado por un (1) árbitro designado de común acuerdo entre las partes; a falta de acuerdo, será designado por el Centro de Conciliación, Arbitraje y Amigable Composición de la Cámara de Comercio de Ibagué, entidad que administrará el trámite conforme a su reglamento vigente al momento de la convocatoria. El tribunal funcionará en la ciudad de Ibagué y su organización interna, honorarios y gastos se sujetarán a las tarifas y disposiciones del respectivo Centro de Arbitraje. Los costos y honorarios del trámite arbitral serán asumidos conforme a lo que disponga el laudo arbitral, sin perjuicio de que durante el trámite las partes deban efectuar provisiones en partes iguales cuando así lo exija el reglamento del Centro de Arbitraje, conservando la parte vencedora el derecho a repetir contra la vencida las sumas que le hubieren correspondido. Parágrafo Primero: En todo caso, la presente cláusula no impedirá a EL(LOS) PROMITENTE(S) COMPRADOR(ES) acudir a la jurisdicción ordinaria, a la jurisdicción de pequeñas causas o a las autoridades administrativas de protección al consumidor cuando la ley así lo permita, ni podrá interpretarse como renuncia anticipada a derechos mínimos reconocidos por normas de orden público. La interpretación de la presente estipulación deberá realizarse de manera sistemática con el régimen de protección al consumidor y, en caso de duda, prevalecerá aquella que garantice el acceso efectivo a la administración de justicia. Parágrafo Segundo: Las partes dejan constancia de que la inclusión de esta cláusula no implica imposición abusiva de foro, ni inversión de la carga probatoria, ni limitación de los derechos procesales del consumidor, y que su finalidad es ofrecer un mecanismo especializado, técnico y expedito de solución de controversias, sin desconocer las garantías legales aplicables. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO TERCERA: INTERPRETACIÓN:', bold: true, underline: true },
      {
        text: ' Las partes convienen que el presente contrato es independiente y constituye el acuerdo completo de las partes. En tal virtud, será el primer instrumento de interpretación de sus voluntades, y el silencio que se guarde en la escritura pública de compraventa que perfeccione el presente negocio jurídico no significa su condonación, a menos que así expresamente se diga. ',
      },
      { text: 'CLÁUSULA VIGÉSIMA CUARTA: NULIDAD PARCIAL:', bold: true, underline: true },
      {
        text: ' Si cualquiera de las manifestaciones contenidas en el presente contrato o el texto parcial de alguna de ellas se declara nulo, ineficaz o inexistente, la validez de las demás no será afectada por tal declaración, salvo que aparezca que las partes hubieran suscrito el contrato sin la estipulación o parte viciada de nulidad o que por la naturaleza y alcance de la misma el contrato no pudiere ser ejecutado o cumplido. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO QUINTA: VALIDEZ DE LA RÚBRICA Y RÚBRICA ELECTRÓNICA:', bold: true, underline: true },
      {
        text: ' Las partes reconocen expresamente que el presente contrato podrá ser suscrito de manera manuscrita o mediante mecanismos electrónicos, digitales o tecnológicos que permitan identificar razonablemente al firmante y asegurar la integridad del documento, conforme a la legislación colombiana vigente sobre mensajes de datos, comercio electrónico y firma electrónica. En consecuencia, cuando la suscripción se realice a través de plataformas tecnológicas de firma electrónica o digital, dicha firma producirá los mismos efectos jurídicos que la firma autógrafa, siempre que el método utilizado permita asociar inequívocamente al firmante con el contenido del documento y garantice que el mismo no ha sido alterado con posterioridad a su suscripción. La utilización de tales mecanismos implicará manifestación válida, libre e informada del consentimiento respecto del contenido contractual. Parágrafo Primero: Las partes acuerdan que la información suministrada en desarrollo de la etapa precontractual y contractual, incluyendo aquella relativa a identificación, datos personales, declaraciones sobre el origen de recursos, conocimiento del cliente y demás documentos que por disposición legal deban integrarse al expediente contractual, podrá ser remitida, diligenciada y aceptada mediante firma electrónica, siempre que el sistema empleado permita verificar su autenticidad y trazabilidad. Parágrafo Segundo: La aceptación electrónica de tales documentos no implicará presunción de veracidad absoluta ni renuncia a los derechos legales de contradicción o aclaración que correspondan al consumidor, pero sí constituirá prueba válida de su envío y aprobación cuando se cumplan los requisitos legales de autenticidad e integridad. En todo caso, el PROMITENTE VENDEDOR conservará los soportes técnicos que acrediten la fecha, hora, dirección IP u otros elementos de validación que respalden la trazabilidad del consentimiento otorgado por medios electrónicos. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO SEXTA: MODIFICACIONES, INTEGRIDAD Y PREVALENCIA CONTRACTUAL:', bold: true, underline: true },
      {
        text: ' El presente contrato constituye el acuerdo íntegro celebrado entre las partes respecto del objeto descrito en la cláusula primera y sustituye cualquier negociación, oferta, comunicación o entendimiento previo que hubiere existido entre ellas en relación con el mismo negocio jurídico, sin perjuicio de la información precontractual que por mandato legal deba entenderse incorporada al contrato. Ninguna estipulación del presente instrumento podrá ser modificada de manera unilateral. Toda adición, aclaración, ajuste o modificación deberá constar por escrito y estar debidamente suscrita por ambas partes o por sus representantes con facultades suficientes, ya sea mediante firma manuscrita o electrónica válida conforme a la ley. Parágrafo Primero: No obstante lo anterior, cuando la modificación derive del cumplimiento de disposiciones legales imperativas, decisiones administrativas de autoridad competente, ajustes urbanísticos obligatorios o cambios normativos que incidan directamente en la ejecución del proyecto, el PROMITENTE VENDEDOR podrá realizar las adecuaciones necesarias para dar cumplimiento a tales disposiciones, informando de manera oportuna AL(LOS) PROMITENTE(S) COMPRADOR(ES), sin que ello constituya modificación arbitraria del equilibrio contractual. Parágrafo Segundo: La nulidad, ineficacia o inaplicabilidad de alguna de las estipulaciones del presente contrato no afectará la validez de las demás, las cuales continuarán produciendo plenos efectos jurídicos, salvo que la disposición afectada resulte esencial para la estructura del negocio y haga imposible su ejecución. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO SÉPTIMA: DOMICILIO CONTRACTUAL:', bold: true, underline: true },
      {
        text: ' Sin perjuicio de las disposiciones procesales, para los efectos relacionados con el presente contrato se fija como domicilio de las partes el municipio de IBAGUÉ, departamento del Tolima. ',
      },
      { text: 'CLÁUSULA TRIGÉSIMO SEGUNDA: INFORMACIÓN PRECONTRACTUAL, NATURALEZA DEL PROYECTO Y CONSENTIMIENTO INFORMADO:', bold: true, underline: true },
      {
        text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES) declara(n) que, previo a la suscripción del presente contrato, recibió(ieron) información clara, suficiente, verificable y oportuna sobre las características esenciales del proyecto objeto del presente contrato, incluyendo la naturaleza del proyecto, ubicación general, especificaciones, estado jurídico-administrativo, plazo estimado de amortización, forma de pago, cargas económicas asociadas y demás aspectos relevantes para la toma de decisión. Manifiesta(n) igualmente que tuvo(ieron) la oportunidad real de formular preguntas, solicitar aclaraciones y examinar los documentos y piezas informativas suministradas, sin que se le(s) hubiere negado acceso razonable a información pertinente para la comprensión del negocio jurídico. Las partes reconocen que, tratándose de un proyecto en etapa de desarrollo, pueden presentarse ajustes razonables derivados de exigencias técnicas, urbanísticas, ambientales o administrativas propias del proceso constructivo, siempre que tales modificaciones no alteren sustancialmente la destinación económica del inmueble ni impliquen desmejora significativa frente a las condiciones objetivamente informadas. En caso de modificaciones relevantes que impacten de manera sustancial el equilibrio contractual, se aplicarán las disposiciones legales pertinentes. Parágrafo: La presente declaración no constituye renuncia a derechos del consumidor ni limita las acciones que la ley le confiere en caso de información inexacta, insuficiente o engañosa, pero sí deja constancia del cumplimiento del deber de información por parte del PROMITENTE VENDEDOR en los términos exigidos por la normatividad vigente. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO OCTAVA: GARANTÍA LEGAL Y PROCEDIMIENTO DE ATENCIÓN DE RECLAMACIONES:', bold: true, underline: true },
      {
        text: ' El PROMITENTE VENDEDOR reconoce que el inmueble objeto del presente contrato estará amparado por la garantía legal prevista en la legislación colombiana aplicable a bienes inmuebles, en particular en lo relacionado con estabilidad de obra, calidad, idoneidad y seguridad, en los términos y plazos establecidos por la ley. EL(LOS) PROMITENTE(S) COMPRADOR(ES) podrá presentar reclamaciones relacionadas con la garantía legal a través de los canales formales de atención dispuestos por el PROMITENTE VENDEDOR, quien deberá dar trámite oportuno, registrar la solicitud y emitir respuesta dentro de los términos previstos por la normativa vigente. ',
      },
      { text: 'CLÁUSULA VIGÉSIMO NOVENA: NOTIFICACIONES CONTRACTUALES Y MEDIOS ELECTRÓNICOS DE COMUNICACIÓN:', bold: true, underline: true },
      {
        text: ' Para efectos de la ejecución del presente contrato, las partes acuerdan que las comunicaciones formales relacionadas con requerimientos de pago, constitución en mora, programación de entrega, observaciones técnicas, solicitudes contractuales y demás actuaciones relevantes serán solamente por escrito, ya sea mediante documento físico entregado en la dirección registrada por cada parte o a través de medios electrónicos enviados a las direcciones de correo electrónico suministradas al momento de la suscripción del contrato. Las partes se obligan a mantener actualizada su información de contacto y a informar cualquier cambio dentro de un plazo razonable. Las comunicaciones electrónicas se entenderán recibidas cuando exista constancia razonable de envío y trazabilidad técnica que permita verificar su remisión a la dirección informada, sin perjuicio del derecho del destinatario de demostrar la imposibilidad real de acceso por causa no imputable a su conducta. El uso de medios electrónicos para notificaciones contractuales no limita el derecho del consumidor a exigir comunicaciones por canales físicos cuando la ley así lo disponga, ni sustituye los requisitos especiales de notificación previstos en normas imperativas, pero sí constituye un mecanismo válido y eficaz de comunicación para la ejecución ordinaria del contrato. Parágrafo Primero: EL PROMITENTE VENDEDOR deja expresa constancia que el único canal autorizado por la compañía para atender, resolver y dar respuesta a quejas, reclamos, solicitudes, aclaraciones o cualquier inquietud relacionada con la firma del presente contrato, la forma de pago, acuerdos de pago, especificaciones técnicas del objeto contractual o cualquier otro asunto derivado de la relación contractual, es la dependencia de SERVICIO AL CLIENTE, mediante comunicación electrónica al correo servicioalcliente.grupomeraki@gmail.com. En consecuencia, EL PROMITENTE VENDEDOR aclara que ninguna otra dependencia de la compañía y/o asesor comercial, o persona distinta al área autorizada de Servicio al Cliente se encuentra facultada para emitir respuestas, brindar información, realizar aclaraciones, asumir compromisos o resolver inquietudes en nombre de la compañía. En caso de que EL(LOS) PROMITENTE(S) COMPRADOR(ES) reciba(n) información, respuestas o comunicaciones por parte de personas no autorizadas, dichas manifestaciones no comprometerán ni generarán obligación alguna para EL PROMITENTE VENDEDOR. En mérito de lo anterior, las partes manifiestan que dan su consentimiento para ser notificadas por medio electrónico en los correos electrónicos relacionados a continuación únicamente. Parágrafo Segundo: EL PROMITENTE VENDEDOR le manifiesta AL(LOS) PROMITENTE(S) COMPRADOR(ES) que los pagos o cancelaciones de su obligación adquirida mediante el presente contrato que realice en cuentas bancarias a terceras personas, a asesores comerciales o mediante envío de link de pagos digitales o mediante supuestas comunicaciones de estímulos por pagos tempranos, o por cualquier otro medio electrónico engañoso, no serán tenidos en cuenta a las cancelaciones de las obligaciones de este contrato ya que los únicos medios de cancelación serán los acordados por las partes taxativamente en la CLÁUSULA TERCERA de este contrato.',
      },
    ]);

  xml = replaceRegion(
    xml,
    (t) => t.startsWith('CLAUSULA SÉPTIMA: ORIGEN DE FONDOS') || t.startsWith('CLÁUSULA SÉPTIMA: ORIGEN DE FONDOS'),
    (t) => t.startsWith('2. Que el lote objeto de este contrato'),
    clauses7to29,
  );

  // 7. Cláusula Trigésima (protección de datos + declaración adicional antes de fecha de firma)
  const clause30And35 = makePara([
    { text: 'CLÁUSULA TRIGÉSIMA: AUTORIZACIÓN PARA EL MANEJO DE DATOS PERSONALES:', bold: true, underline: true },
    {
      text: ' De conformidad con lo previsto en la Ley 1581 de 2012 “por la cual se dictan las disposiciones generales para la protección de datos personales” y el Decreto 1377 de 2013 que la reglamentan parcialmente, EL(LOS) PROMITENTE(S) COMPRADOR(ES) declara(n) que ha(n) sido informado(s) de manera clara, suficiente y previa acerca de la política de tratamiento de datos personales del PROMITENTE VENDEDOR, su calidad de responsable del tratamiento, los canales habilitados para el ejercicio de derechos y las finalidades específicas para las cuales serán recolectados sus datos personales en desarrollo del presente contrato. En virtud de lo anterior, otorga(n) autorización libre, previa, expresa e informada para que el PROMITENTE VENDEDOR recolecte, almacene, use, circule, actualice, transmita o suprima sus datos personales estrictamente para las finalidades relacionadas con la ejecución del presente negocio jurídico: la gestión precontractual y contractual, verificación de identidad, análisis de riesgo, estudio de capacidad financiera, cumplimiento de obligaciones legales y regulatorias, administración contable y tributaria, gestión de cartera, atención de solicitudes, envío de información relacionada con el proyecto y demás actuaciones directamente vinculadas con la ejecución y cumplimiento de este contrato. Parágrafo Primero: El PROMITENTE VENDEDOR se obliga a realizar el tratamiento de los datos conforme a los principios de legalidad, finalidad, libertad, veracidad, transparencia, acceso y circulación restringida, seguridad y confidencialidad previstos en la legislación vigente, adoptando medidas técnicas, humanas y administrativas razonables para proteger la información contra pérdida, uso indebido o acceso no autorizado. Parágrafo Segundo: EL(LOS) PROMITENTE(S) COMPRADOR(ES) reconoce(n) que podrá(n) ejercer en cualquier momento sus derechos a conocer, actualizar, rectificar y suprimir sus datos personales, así como a revocar la autorización otorgada, siempre que no exista deber legal o contractual que impida su eliminación, mediante solicitud presentada a través de los canales informados en la política de tratamiento de datos del PROMITENTE VENDEDOR. Parágrafo Tercero: En relación con la información financiera, crediticia y comercial, EL(LOS) PROMITENTE(S) COMPRADOR(ES) autoriza(n) de manera expresa al PROMITENTE VENDEDOR para consultar, solicitar, reportar, procesar y divulgar ante operadores de información, centrales de riesgo o entidades que administren bases de datos de carácter financiero, crediticio, comercial o de servicios, información relacionada con su comportamiento de pago derivado del presente contrato, todo ello conforme a lo dispuesto en la Ley 1266 de 2008 y las normas que la modifiquen o sustituyan. Parágrafo Cuarto: El eventual reporte de información negativa solo procederá en caso de mora cierta, expresa y exigible, una vez cumplidos los deberes de información previa al titular establecidos en la ley de habeas data financiero. El PROMITENTE VENDEDOR garantizará que los datos reportados sean veraces, completos, actualizados y comprobables. Parágrafo Quinto: La información relativa al presente contrato podrá ser suministrada a autoridades judiciales o administrativas cuando medie obligación legal o requerimiento formal, así como a terceros encargados del tratamiento que presten servicios relacionados con la ejecución del proyecto, bajo acuerdos que garanticen la confidencialidad y seguridad de la información. Parágrafo Sexto: La presente autorización se otorga por el término de duración del contrato y por el tiempo adicional que resulte necesario para el cumplimiento de obligaciones legales, contractuales o de conservación documental, sin que ello implique tratamiento indefinido para finalidades distintas a las aquí previstas. ',
    },
    { text: 'CLÁUSULA TRIGÉSIMO QUINTA: DECLARACIÓN ADICIONAL:', bold: true, underline: true },
    {
      text: ' EL(LOS) PROMITENTE(S) COMPRADOR(ES) declaran que tuvieron oportunidad de revisar el texto del presente contrato y sus anexos, que conocen ampliamente el proyecto y que entienden, aprueban y aceptan su contenido y alcances.',
    },
  ]);

  xml = replaceRegion(
    xml,
    (t) => t.startsWith('CLÁUSULA TRIGÉSIMO CUARTA: AUTORIZACIÓN'),
    (t) => t.startsWith('CLÁUSULA TRIGÉSIMO CUARTA: AUTORIZACIÓN'),
    clause30And35,
  );

  checkWellFormed(xml, 'promesa-sobre-montanas-2026');
  checkNoForbiddenText(xml, 'promesa-sobre-montanas-2026');

  zip.file('word/document.xml', xml);
  const outPath = path.join(TEMPLATES_DIR, 'promesa-sobre-montanas-2026.docx');
  fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('Generada:', outPath);
}

buildPreventaSobreMontanas();
buildPromesaSobreMontanas();
