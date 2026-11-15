import unittest

import pandas as pd

from gradientdescentfarmers.model_builder.siap_observations import (
    load_municipal_siap_observations,
)


class FakeClient:
    def read_frame(self, uri):
        year = int(uri.rsplit("_", 1)[-1].removesuffix(".csv"))
        frame = pd.DataFrame({
            "Anio": [year, year],
            "Nomestado": ["Guanajuato", "Guanajuato"],
            "Nommunicipio": ["Valle de Santiago", "Valle de Santiago"],
            "Nomunidad": ["Tonelada", "Tonelada"],
            "Nomcicloproductivo": ["Primavera-Verano", "Otoño-Invierno"],
            "Nommodalidad": ["Riego", "Temporal"],
            "Sembrada": [10.0, 5.0],
            "Cosechada": [10.0, 5.0],
            "Volumenproduccion": [20.0, 0.0],
            "Valorproduccion": [50000.0, 0.0],
        })
        crop_column = "Nomcultivo Sin Um" if year == 2015 else "Nomcultivo"
        frame[crop_column] = ["Maíz grano", "Cebada grano"]
        return frame


class SiapObservationsTests(unittest.TestCase):
    def test_none_keeps_all_crops_and_old_column_alias(self):
        result = load_municipal_siap_observations(
            FakeClient(), municipality="Valle de Santiago", state="Guanajuato",
            years=(2015, 2024), selected_products=None,
        )
        self.assertEqual(len(result), 4)
        self.assertEqual(set(result.crop_label), {"Maíz grano", "Cebada grano"})
        maize = result[result.crop_label.eq("Maíz grano")]
        self.assertEqual(maize.observed_price_mxn_t.tolist(), [2500.0, 2500.0])
        self.assertEqual(maize.observed_yield_t_ha.tolist(), [2.0, 2.0])
        self.assertTrue(result[result.crop_label.eq("Cebada grano")].observed_price_mxn_t.isna().all())
        self.assertTrue(result.data_origin.eq("SIAP_OBSERVED").all())
        self.assertFalse(result.is_wofost_simulation.any())

    def test_explicit_crop_label_filters_rows(self):
        result = load_municipal_siap_observations(
            FakeClient(), municipality="Valle de Santiago", state="Guanajuato",
            years=(2024,), selected_products=["Maíz grano"],
        )
        self.assertEqual(result.crop_label.tolist(), ["Maíz grano"])


if __name__ == "__main__":
    unittest.main()
