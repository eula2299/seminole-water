import unittest
from national.prediction_benchmark import parse_record,transitions,split,HOLDOUT_STATES

def record(day='2024-01-01',label=0,state='GA'):
    return {'pwsid':state+'1234567','state':state,'group':(state+'1234567','f','p','PFOA','m','ug/l'),'sample':day,'date':day,'label':label,'mrl':.004,'chemical':'PFOA'}

class BenchmarkTests(unittest.TestCase):
    def test_target_value_does_not_enter_its_own_features(self):
        a=transitions([record(),record('2024-04-01',0)]);b=transitions([record(),record('2024-04-01',1)])
        self.assertEqual(a[0]['x'],b[0]['x']);self.assertNotEqual(a[0]['y'],b[0]['y'])
    def test_future_round_does_not_change_earlier_features(self):
        a=transitions([record(),record('2024-04-01',0)])
        b=transitions([record(),record('2024-04-01',0),record('2024-07-01',1)])
        self.assertEqual(a[0],b[0])
    def test_same_day_replicates_do_not_create_transitions(self):
        self.assertEqual(transitions([record(label=0),record(label=1)]),[])
    def test_first_round_does_not_create_an_unobserved_prior(self):self.assertEqual(transitions([record()]),[])
    def test_states_and_years_are_held_out_together(self):
        rows=[]
        for state in ['GA','FL']:
            rows+=transitions([record('2024-01-01',state=state),record('2024-06-01',1,state),record('2025-02-01',0,state)])
        train,test=split(rows)
        self.assertTrue(train and test)
        self.assertTrue(all(r['state'] not in HOLDOUT_STATES and r['date']<'2025-01-01' for r in train))
        self.assertTrue(all(r['state'] in HOLDOUT_STATES and r['date']>='2025-01-01' for r in test))
        self.assertFalse({r['pwsid'] for r in train}&{r['pwsid'] for r in test})
    def test_nondetect_is_a_label_not_an_imputed_concentration(self):
        raw={'PWSID':'GA1234567','FacilityID':'f','SamplePointID':'p','SampleID':'a','MethodID':'m','Contaminant':'PFOA','Units':'ug/L','CollectionDate':'01/01/2024','AnalyticalResultsSign':'<','AnalyticalResultValue':'','MRL':'.004'}
        row=parse_record(raw,'2026-09-18');self.assertEqual(row['label'],0);self.assertEqual(row['value'],'')
        raw['AnalyticalResultsSign']='?'
        with self.assertRaises(ValueError):parse_record(raw,'2026-09-18')
if __name__=='__main__':unittest.main()
