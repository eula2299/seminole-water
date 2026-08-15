/* Resident-facing content for IsMyWaterOK. Keep technical backend data out of this file. */
window.WATER_ROADMAP = (() => {
  const cities = [
    {
      key:'sanford', name:'Sanford', match:/sanford/i,
      phone:'407-688-5100',
      water:'https://sanfordfl.gov/government/public-works-utilities/water_and_sewer/',
      quality:'https://sanfordfl.gov/government/public-works-utilities/water_and_sewer/',
      dioxane:'https://sanfordfl.gov/government/public-works-utilities/water_and_sewer/water-quality-14-dioxane/',
      note:'Sanford publishes annual water reports, water-quality alerts, and a dedicated 1,4-dioxane update page.',
      noteEs:'Sanford publica informes anuales del agua, alertas de calidad y una página específica sobre 1,4-dioxano.'
    },
    {
      key:'lake-mary', name:'Lake Mary', match:/lake mary/i,
      phone:'407-585-1452',
      water:'https://www.lakemaryfl.com/329/Potable-Water',
      quality:'https://www.lakemaryfl.com/341/Water-Quality',
      dioxane:'https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane',
      note:'Lake Mary Public Works publishes its drinking-water report and water-quality information.',
      noteEs:'Lake Mary Public Works publica su informe de agua potable e información sobre la calidad del agua.'
    },
    {
      key:'oviedo', name:'Oviedo', match:/oviedo/i,
      phone:'407-971-5681', emergency:'407-256-5026',
      water:'https://www.cityofoviedo.net/1206/Water',
      quality:'https://www.cityofoviedo.net/1206/Water',
      note:'Oviedo Public Works operates the city drinking-water system and posts water information and maintenance notices.',
      noteEs:'Oviedo Public Works opera el sistema de agua potable y publica información y avisos de mantenimiento.'
    },
    {
      key:'winter-springs', name:'Winter Springs', match:/winter springs/i,
      phone:'407-327-1800',
      water:'https://www.winterspringsfl.org/474/Potable-Drinking-Water',
      quality:'https://winterspringsfl.org/475/Annual-Drinking-Water-Reports',
      note:'Winter Springs posts annual drinking-water reports and information about its potable-water system.',
      noteEs:'Winter Springs publica informes anuales de agua potable e información sobre su sistema de agua.'
    },
    {
      key:'altamonte-springs', name:'Altamonte Springs', match:/altamonte/i,
      phone:'407-571-8340', emergency:'407-571-8686',
      water:'https://www.altamonte.org/464/Drinking-Water',
      quality:'https://www.altamonte.org/464/Drinking-Water',
      note:'Altamonte Springs publishes annual drinking-water reports, including a Spanish report, plus PFAS and water-quality updates.',
      noteEs:'Altamonte Springs publica informes anuales de agua potable, incluso en español, además de información sobre PFAS y calidad del agua.'
    },
    {
      key:'casselberry', name:'Casselberry', match:/casselberry/i,
      phone:'407-262-7725',
      water:'https://www.casselberry.org/176/Utilities',
      quality:'https://www.casselberry.org/176/Utilities',
      note:'Casselberry Utilities publishes its latest drinking-water report and utility contact information.',
      noteEs:'Casselberry Utilities publica su informe más reciente de agua potable y la información de contacto del servicio.'
    },
    {
      key:'longwood', name:'Longwood', match:/longwood/i,
      phone:'407-263-2341', emergency:'407-339-1297',
      water:'https://www.longwoodfl.org/253/Public-Utilities',
      quality:'https://www.longwoodfl.org/253/Public-Utilities',
      note:'Longwood Public Utilities posts its Consumer Confidence Report and utility contacts.',
      noteEs:'Longwood Public Utilities publica su informe anual de agua y los contactos del servicio.'
    },
    {
      key:'seminole-county', name:'Unincorporated Seminole County', match:/seminole county|seminole/i,
      phone:'407-665-2110',
      water:'https://www.seminolecountyfl.gov/departments-services/utilities/water/',
      quality:'https://www.seminolecountyfl.gov/departments-services/utilities/water/potable-water-quality',
      alerts:'https://www.seminolecountyfl.gov/departments-services/utilities/water/boil-water-advisories',
      dioxane:'https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane',
      note:'Seminole County Utilities serves large parts of unincorporated Seminole County and publishes water reports, alerts, and 1,4-dioxane information.',
      noteEs:'Seminole County Utilities sirve gran parte del condado no incorporado y publica informes, alertas e información sobre 1,4-dioxano.'
    }
  ];

  const issues = {
    lead:{
      name:'Lead', nameEs:'Plomo',
      blurb:'Lead is most important for babies, children, and pregnancy because it can affect the developing brain.',
      blurbEs:'El plomo es especialmente importante para bebés, niños y durante el embarazo porque puede afectar el cerebro en desarrollo.',
      long:'Repeated exposure can permanently affect IQ, attention, learning, and behavior in children. In adults, lead exposure is linked with high blood pressure, kidney damage, and reproductive problems.',
      longEs:'La exposición repetida puede afectar de forma permanente el coeficiente intelectual, la atención, el aprendizaje y el comportamiento de los niños. En adultos, se relaciona con presión arterial alta, daño renal y problemas reproductivos.',
      action:'If lead is a concern, focus on the lead result shown for your water system, your home’s age/plumbing, and an approved lead test for your tap.',
      actionEs:'Si le preocupa el plomo, revise el resultado del sistema, la edad y tuberías de su vivienda y considere una prueba aprobada de plomo en el grifo.',
      official:'https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water'
    },
    pfas:{
      name:'PFAS “forever chemicals”', nameEs:'PFAS “químicos eternos”',
      blurb:'PFAS are a family of persistent chemicals; health effects differ by the specific compound and exposure.',
      blurbEs:'Los PFAS son una familia de sustancias persistentes; los efectos dependen del compuesto y de la exposición.',
      long:'Studies of certain PFAS link higher exposure with cholesterol changes, liver and immune effects, pregnancy/developmental effects, and increased risk of kidney or testicular cancer.',
      longEs:'Estudios de ciertos PFAS relacionan una mayor exposición con cambios en colesterol, efectos en hígado e inmunidad, embarazo/desarrollo y mayor riesgo de cáncer de riñón o testículo.',
      action:'Review the PFAS result for your provider and whether any current result is above a federal drinking-water limit.',
      actionEs:'Revise el resultado de PFAS de su proveedor y si algún resultado actual supera un límite federal de agua potable.',
      official:'https://www.epa.gov/pfas/our-current-understanding-human-health-and-environmental-risks-pfas'
    },
    dioxane:{
      name:'1,4-dioxane', nameEs:'1,4-dioxano',
      blurb:'1,4-dioxane is an industrial chemical that has been a local groundwater concern in northwest Seminole County.',
      blurbEs:'El 1,4-dioxano es un químico industrial que ha sido una preocupación de agua subterránea en el noroeste del condado de Seminole.',
      long:'Federal health reviews identify liver toxicity and cancer risk as important long-term concerns from repeated drinking-water exposure.',
      longEs:'Evaluaciones federales identifican toxicidad hepática y riesgo de cáncer como preocupaciones importantes de exposición repetida por agua potable.',
      action:'Use the Seminole County address-oriented 1,4-dioxane page and your provider’s latest update for current local results.',
      actionEs:'Use la página del Condado de Seminole sobre 1,4-dioxano y la actualización más reciente de su proveedor para resultados locales actuales.',
      official:'https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane'
    },
    bacteria:{
      name:'Bacteria and germs', nameEs:'Bacterias y gérmenes',
      blurb:'Disease-causing germs can make people sick quickly and are the reason boil-water notices matter.',
      blurbEs:'Los gérmenes que causan enfermedades pueden enfermar rápidamente y por eso son importantes los avisos de hervir el agua.',
      long:'The main concern is infection rather than years of buildup. Possible illness includes diarrhea, vomiting, cramps, and—in some infections—more serious disease.',
      longEs:'La principal preocupación es la infección, no la acumulación durante años. Puede causar diarrea, vómitos, cólicos y, en algunas infecciones, enfermedad más grave.',
      action:'If an official boil-water notice affects your area, follow it until the utility says the notice has been lifted.',
      actionEs:'Si un aviso oficial de hervir el agua afecta su zona, sígalo hasta que el servicio indique que terminó.',
      official:'https://www.seminolecountyfl.gov/departments-services/utilities/water/boil-water-advisories'
    },
    chlorine:{
      name:'Chlorine taste or smell', nameEs:'Sabor u olor a cloro',
      blurb:'Chlorine is used to kill germs. A noticeable taste or smell can occur during normal treatment or temporary flushing.',
      blurbEs:'El cloro se usa para eliminar gérmenes. El sabor u olor puede notarse durante el tratamiento normal o limpiezas temporales.',
      long:'The disinfectant itself is not usually a chronic disease concern at normal allowed levels; unusually high levels can irritate the eyes, nose, or stomach.',
      longEs:'A niveles permitidos normalmente no es una preocupación de enfermedad crónica; niveles inusualmente altos pueden irritar ojos, nariz o estómago.',
      action:'Check whether your provider announced a chlorine flush. If the change is strong, sudden, or persistent, contact the utility.',
      actionEs:'Revise si su proveedor anunció una limpieza con cloro. Si el cambio es fuerte, repentino o persistente, contacte al servicio.',
      official:'https://www.epa.gov/dwreginfo/chemical-contaminant-rules'
    },
    hardness:{
      name:'Hard water', nameEs:'Agua dura',
      blurb:'Hard water comes mainly from dissolved calcium and magnesium and often leaves spots or scale.',
      blurbEs:'El agua dura proviene principalmente de calcio y magnesio disueltos y suele dejar manchas o sarro.',
      long:'Hardness is usually a household-use issue rather than a drinking-water disease concern.',
      longEs:'La dureza suele ser un problema de uso doméstico más que una preocupación de enfermedad por beber el agua.',
      action:'If scale is the main problem, check your provider’s hardness information before assuming the water is contaminated.',
      actionEs:'Si el sarro es el problema principal, revise la información de dureza de su proveedor antes de asumir contaminación.',
      official:'https://www.epa.gov/sdwa/secondary-drinking-water-standards-guidance-nuisance-chemicals'
    },
    cloudy:{
      name:'Cloudy or milky water', nameEs:'Agua turbia o lechosa',
      blurb:'Cloudiness can come from harmless air bubbles, sediment, or a water-system disturbance.',
      blurbEs:'La turbidez puede deberse a burbujas de aire, sedimento o una alteración del sistema.',
      long:'Cloudiness by itself does not name a disease risk. If it is caused by a treatment or pressure problem, the utility should investigate it.',
      longEs:'La turbidez por sí sola no indica un riesgo de enfermedad específico. Si se debe a un problema de tratamiento o presión, el servicio debe investigarlo.',
      action:'Fill a clear glass and wait a few minutes. If it clears from the bottom upward, trapped air is likely. Persistent color, particles, or an alert should be checked with the utility.',
      actionEs:'Llene un vaso transparente y espere unos minutos. Si se aclara desde abajo hacia arriba, probablemente es aire. Color o partículas persistentes deben consultarse con el servicio.',
      official:'https://www.epa.gov/sdwa/secondary-drinking-water-standards-guidance-nuisance-chemicals'
    },
    well:{
      name:'Private wells', nameEs:'Pozos privados',
      blurb:'Private wells are not managed like a city water system, so the homeowner is responsible for routine testing and responding to nearby groundwater concerns.',
      blurbEs:'Los pozos privados no se administran como un sistema municipal; el propietario es responsable de las pruebas rutinarias y de responder a problemas de agua subterránea cercanos.',
      long:'Long-term health effects depend entirely on what is present—such as bacteria, nitrate, arsenic, solvents, or other contaminants.',
      longEs:'Los efectos a largo plazo dependen de lo que esté presente: bacterias, nitrato, arsénico, solventes u otros contaminantes.',
      action:'Use the private-well view for your address, then use a state-approved lab for the contaminants relevant to your situation.',
      actionEs:'Use la vista de pozo privado para su dirección y luego un laboratorio aprobado por el estado para los contaminantes relevantes.',
      official:'https://seminole.floridahealth.gov/programs-and-services/environmental-public-health/drinking-water-services/'
    }
  };

  const problems = [
    {key:'brown', icon:'◐', en:'Brown, yellow, or rusty water', es:'Agua marrón, amarilla u oxidada', why:'Often sediment, iron, or a pipe disturbance. A sudden neighborhood-wide change can follow hydrant flushing or a main break.', whyEs:'A menudo se debe a sedimento, hierro o una alteración de tuberías. Un cambio repentino en el vecindario puede seguir a una limpieza de hidrantes o rotura de tubería.', do:'Run cold water briefly and check local alerts. If discoloration persists, avoid laundry with it and contact your water provider.', doEs:'Deje correr agua fría brevemente y revise alertas locales. Si persiste, evite lavar ropa con ella y contacte a su proveedor.'},
    {key:'cloudy', icon:'◌', en:'Cloudy or milky water', es:'Agua turbia o lechosa', why:'Frequently trapped air, but persistent particles or cloudiness can signal sediment or a system issue.', whyEs:'Frecuentemente es aire atrapado, pero partículas o turbidez persistentes pueden indicar sedimento o un problema del sistema.', do:'Try the clear-glass test. If it does not clear after several minutes or appears with an alert, contact the utility.', doEs:'Pruebe con un vaso transparente. Si no se aclara después de varios minutos o aparece con una alerta, contacte al servicio.'},
    {key:'sulfur', icon:'≈', en:'Rotten-egg or sulfur smell', es:'Olor a huevo podrido o azufre', why:'Hydrogen sulfide can occur naturally in Florida groundwater or in a home water heater.', whyEs:'El sulfuro de hidrógeno puede aparecer naturalmente en el agua subterránea de Florida o en el calentador de agua.', do:'Compare hot and cold water. If only hot water smells, the water heater may be involved; if both do, contact the provider.', doEs:'Compare agua caliente y fría. Si solo huele la caliente, puede ser el calentador; si ambas huelen, contacte al proveedor.'},
    {key:'chlorine', icon:'◇', en:'Strong chlorine taste or smell', es:'Sabor u olor fuerte a cloro', why:'Utilities sometimes change disinfection temporarily during system flushing.', whyEs:'Los servicios a veces cambian temporalmente la desinfección durante limpiezas del sistema.', do:'Check provider notices first. If the smell is unusually strong or does not improve, contact the utility.', doEs:'Revise primero los avisos del proveedor. Si el olor es inusualmente fuerte o no mejora, contacte al servicio.'},
    {key:'metallic', icon:'●', en:'Metallic taste', es:'Sabor metálico', why:'Can come from plumbing, iron, copper, or other metals. Taste alone cannot identify which one.', whyEs:'Puede provenir de tuberías, hierro, cobre u otros metales. El sabor por sí solo no identifica cuál.', do:'Review metal results for your provider. If you are concerned about lead or copper from home plumbing, use an approved tap-water test.', doEs:'Revise los resultados de metales de su proveedor. Si le preocupa plomo o cobre de las tuberías de su casa, use una prueba aprobada del grifo.'},
    {key:'pressure', icon:'↓', en:'Low pressure or no water', es:'Baja presión o sin agua', why:'Can follow a main break, repair, valve issue, or a problem inside the property.', whyEs:'Puede seguir a una rotura de tubería, reparación, válvula o un problema dentro de la propiedad.', do:'Check whether neighbors are affected and look for a local notice. Contact the serving utility for a sudden area-wide pressure loss.', doEs:'Compruebe si los vecinos están afectados y busque un aviso local. Contacte al servicio si la pérdida de presión es repentina y general.'},
    {key:'lead-home', icon:'⌂', en:'Older home or lead concern', es:'Casa antigua o preocupación por plomo', why:'Lead in drinking water usually comes from service lines, solder, fixtures, or plumbing rather than the source water itself.', whyEs:'El plomo en el agua suele provenir de líneas de servicio, soldaduras, grifos o tuberías, no del agua de origen.', do:'Open the lead guide, review your provider’s lead information, and use an approved tap test if you need to know your home’s level.', doEs:'Abra la guía de plomo, revise la información de su proveedor y use una prueba aprobada si necesita conocer el nivel de su casa.'},
    {key:'well', icon:'⌄', en:'I use a private well', es:'Uso un pozo privado', why:'Private wells need a different path because routine testing and maintenance are the owner’s responsibility.', whyEs:'Los pozos privados necesitan un proceso distinto porque las pruebas y mantenimiento son responsabilidad del propietario.', do:'Use the private-well section after your address lookup to see nearby well information and local testing options.', doEs:'Use la sección de pozo privado después de buscar su dirección para ver información cercana y opciones de pruebas.'}
  ];

  const labs = [
    {name:'Flowers Labs', city:'Altamonte Springs', address:'481 Newburyport Ave., Altamonte Springs, FL 32701', phone:'407-339-5984'},
    {name:'PC&B', city:'Oviedo', address:'210 Park Road, Oviedo, FL 32765', phone:'407-359-7194'},
    {name:'HBEL', city:'Sanford', address:'4155 St Johns Parkway, Sanford, FL 32771', phone:'407-322-4686'},
    {name:'AEL', city:'Altamonte Springs', address:'380 Northlake Blvd., Suite 1048, Altamonte Springs, FL 32701', phone:'407-937-1594'},
    {name:'Watershed', city:'DeLand', address:'304 Spring Garden Ave. S., DeLand, FL 32720', phone:'386-736-3397'}
  ];

  const sources = {
    labs:'https://seminole.floridahealth.gov/programs-and-services/environmental-public-health/state-approved-water-labs/',
    well:'https://seminole.floridahealth.gov/programs-and-services/environmental-public-health/drinking-water-services/',
    alerts:'https://www.seminolecountyfl.gov/departments-services/utilities/water/boil-water-advisories',
    dioxane:'https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane'
  };

  function cityFrom(text='') {
    const s=String(text||'');
    return cities.find(c=>c.match.test(s)) || cities[cities.length-1];
  }

  return {cities, issues, problems, labs, sources, cityFrom};
})();
