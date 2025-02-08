jQuery(document).ready(function(){
   //	jQuery('.no_result').css('display','none');
         //jQuery('.case-study').css('display','none');
		 $.get("https://api.ipify.org?format=json", function(data) {
    //console.log("Your IP address is:", data.ip);
	$('.getUserIp').val(data.ip);
});
         if ($('.filter-output').html() == "") {
           $('.no_result').css('display','block');
          
       }
	   
	   jQuery('#form-handler input[name=email]').on('input', function() {
        var email = $(this).val();
        var blockedDomain = 'mailinator.com';

        if (email.endsWith(blockedDomain)) {
            jQuery(this).val(''); // Clear the input field if it contains the blocked domain
            $(this).after('<p class="error emailError">Please enter work email address</p>');
        }
		else{
			$('.emailError').remove();
		}
        
    });
	
	jQuery('.workShopForm input[name=email]').on('input', function() {
       
        var inputValue = $(this).val();
        if(inputValue.includes('gmail.com') || inputValue.includes('yahoo.com')) {
             $(this).after('<p class="error emailError">Please enter work email address</p>');
            $(this).val(''); // Clear the input field
        }
		else{
			$('.emailError').remove();
		}
        
        
    });
	
	 jQuery('#form-handler-insurance input[name=email]').on('input', function() {
        var email = $(this).val();
        var blockedDomain = 'mailinator.com';

        if (email.endsWith(blockedDomain)) {
            jQuery(this).val(''); // Clear the input field if it contains the blocked domain
            $(this).after('<label id="email-error" class="error" for="email">Please enter work email address</label>');
        }
		else{
			$('#email-error').text('');
		}
        
    });
	
      })
      jQuery('.tabInsight').click(function(e){
         $('#insight .resource-download').show();
         jQuery('.filter-output1').show();
          jQuery('.filter-output').hide();
         jQuery('.ajaxContent').hide();
      });
      jQuery('.tabCaseStudy').click(function(e){
         $('#case-study .resource-download').show();
         jQuery('.filter-output2').show();
          jQuery('.filter-output').hide();
         jQuery('.ajaxContent').hide();
         
      });
      jQuery('.resource-story-link .case-study').click(function(e){
          e.preventDefault();
          jQuery('.resource-download .resource-blog-div').hide();
         // $("input:radio[name=resources]").attr("disabled",true);
         jQuery('#case-study').show();
         
      })


$('div.practice-guide').click(function() {
   window.open("http://www.damcogroup.com/resources/software-development-report.html", '_blank');
})
$('div.trends').click(function() {
   window.open("http://www.damcogroup.com/it-trends-report-2018.html", '_blank');
})
$('div.strategy-guide').click(function() {
   window.open("http://damcodigital.com/product-launch-strategy-guide/", '_blank');
})
$('div.salesforce-guide').click(function() {
   window.open("https://www.damcogroup.com/resources/salesforce-for-wealth-management-companies", '_blank');
})
$('div.product-launch').click(function() {
   window.open("http://www.damcogroup.com/resources/salesforce-einstein.html", '_blank');
})
$('div.outsourced-product').click(function() {
   window.open("https://www.damcogroup.com/resources/outsourced-product-development.html", '_blank');
})
$('div.businesses').click(function() {
   window.open("https://www.damcogroup.com/resources/guide-for-insurance-business-caribbean.html", '_blank');
})
$('div.as-modernization').click(function() {
   window.open("https://www.damcogroup.com/resources/as400-application-modernization.html", '_blank');
})
$('div.fintech').click(function() {
   window.open("https://www.damcogroup.com/resources/FinTech-Product-Development.html", '_blank');
})
$('div.agentmgmt').click(function() { 
   window.open("https://www.damcogroup.com/resources/agent-relationship-management-guide/", '_blank');
})
$('div.tech-leadership').click(function() { 
   window.open("https://www.damcogroup.com/resources/technology-leadership-study.html", '_blank');
})
$('div.lead-generation').click(function() { 
   window.open("https://www.damcogroup.com/resources/insurance-lead-generation-and-conversion-guide/", '_blank');
})
$('div.unlock-crm-report').click(function() { 
   window.open("https://www.damcogroup.com/resources/CRM-for-Insurance-Report", '_blank');
})
$('div.Brighter-tomorrow').click(function() { 
   window.open("https://www.damcogroup.com/resources/navigating-the-covid-19-crisis-a-practical-guide-for-business/", '_blank');
})
$('div.covid-19').click(function() {
 window.open("https://www.damcogroup.com/resources/covid-19-insurance-industry-imperatives/", '_blank');
})
$('div.process-automation').click(function() {
    window.open("https://www.damcogroup.com/resources/process-automation-in-investment-management-webinar/", '_blank');
})
$('div.software-modernization').click(function() {
 window.open("https://www.damcogroup.com/software-modernization-stories-2020/", '_blank');
})	
$('div.insurance-crm-software').click(function() {
   window.open("https://www.damcogroup.com/resources/insurance-crm-software-comprehensive-guide", '_blank');
})	

$('div.accelerator-demo').click(function() {
   window.open("https://www.damcogroup.com/resources/rapadit-development-accelerator", '_blank');
})	
$('div.cloud-ROI').click(function() {
   window.open("https://www.damcogroup.com/resources/cloud-roi-assessment-workshop", '_blank');
})	

$('div.Your-Salesforce-License').click(function() {
   window.open("https://www.damcogroup.com/resources/salesforce-licensing-cost-optimization-webinar", '_blank');
}) 
$('div.insurance-webinar').click(function() {
   window.open("https://www.damcogroup.com/resources/smarter-claims-process-with-an-aI-enabled-ecosystem", '_blank');
})
 
$.validator.addMethod('noemail', function (value) {
    return /^([\w-.]+@(?!gmail\.com)(?!yahoo\.com)(?!hotmail\.com)(?!mail\.ru)(?!yandex\.ru)(?!mail\.com)([\w-]+.)+[\w-]{2,4})?$/.test(value);
}, 'Please enter work email address.');

  $('#form-handler-insurance').validate({
  rules: {
    email: {
      required: true,
      email: true,
	  noemail: true
    },
	first_name: {
      required: true,
      
    },
	last_name: {
      required: true,
      
    },
	company: {
      required: true,
      
    },
	phone: {
      required: true,
         
    },
	date: {
      required: true,
         
    },
	time: {
      required: true,
         
    }
  }
});



